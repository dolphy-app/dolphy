import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RuleFinding } from './manifest.ts';

/** A code file of a built extension; `path` is relative to the extension directory. */
export interface BundleFile {
  path: string;
  text: string;
}

const CODE_FILE = /\.(?:mjs|js|cjs)$/;
const OBFUSCATION_MIN_BYTES = 20 * 1024;
const OBFUSCATION_LINE_LENGTH = 500;
const OBFUSCATION_IDENTIFIERS = 20;

const DYNAMIC_EXECUTION = /(?<![\w$])(?:eval\s*\(|new\s+Function\s*\()/;
const HEX_IDENTIFIER = /(?<![\w$])_0x[0-9a-f]{3,}(?![\w$])/gi;
const URL_PATTERN = /https?:\/\/[^\s"'`<>)\\]+/g;
const SOURCE_MAP = /\/\/[#@]\s*sourceMappingURL=/;
/** XML namespaces (`createElementNS`) are identifiers, not network addresses. */
const NAMESPACE_URL = /^https?:\/\/www\.w3\.org\//;

const listCodeFiles = async (dir: string, prefix = ''): Promise<string[]> => {
  const entries = await readdir(path.join(dir, prefix), {
    withFileTypes: true,
  });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) return listCodeFiles(dir, relative);
      return entry.isFile() && CODE_FILE.test(entry.name) ? [relative] : [];
    }),
  );
  return nested.flat().sort();
};

/** Code files (`.mjs`, `.js`, `.cjs`) of a built extension directory. */
export const readBundleFiles = async (dir: string): Promise<BundleFile[]> =>
  Promise.all(
    (await listCodeFiles(dir)).map(async (file) => ({
      path: file,
      text: await readFile(path.join(dir, file), 'utf8'),
    })),
  );

const isObfuscated = (text: string): string | null => {
  const size = Buffer.byteLength(text);
  if (size >= OBFUSCATION_MIN_BYTES) {
    const average = size / text.split('\n').length;
    if (average > OBFUSCATION_LINE_LENGTH) {
      return `average line length is ${Math.round(average)} characters`;
    }
  }
  const identifiers = new Set(text.match(HEX_IDENTIFIER) ?? []);
  return identifiers.size >= OBFUSCATION_IDENTIFIERS
    ? `${identifiers.size} identifiers of the form _0x1a2b`
    : null;
};

/**
 * Heuristics over the built code (`CHECK-022`…`CHECK-025`). They read the
 * whole bundle, dependencies included, so only the source map is an error.
 */
export const bundleFindings = (
  files: readonly BundleFile[],
  permissions: readonly string[],
): RuleFinding[] => {
  const findings: RuleFinding[] = [];
  const mayUseNetwork = permissions.includes('network');
  for (const { path: field, text } of files) {
    if (DYNAMIC_EXECUTION.test(text)) {
      findings.push({
        ruleId: 'CHECK-022',
        severity: 'warning',
        field,
        message: 'dynamic code execution (eval or new Function)',
      });
    }
    const obfuscation = isObfuscated(text);
    if (obfuscation !== null) {
      findings.push({
        ruleId: 'CHECK-023',
        severity: 'warning',
        field,
        message: `looks obfuscated: ${obfuscation}`,
      });
    }
    if (!mayUseNetwork) {
      const url = (text.match(URL_PATTERN) ?? []).find(
        (item) => !NAMESPACE_URL.test(item),
      );
      if (url !== undefined) {
        findings.push({
          ruleId: 'CHECK-024',
          severity: 'warning',
          field,
          message: `URL ${url} in code without the 'network' permission`,
        });
      }
    }
    if (SOURCE_MAP.test(text)) {
      findings.push({
        ruleId: 'CHECK-025',
        severity: 'error',
        field,
        message: 'embedded source map: the catalog builds without maps',
      });
    }
  }
  return findings;
};
