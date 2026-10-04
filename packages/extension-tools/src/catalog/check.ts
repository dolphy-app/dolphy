import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  formatDiagnostic,
  inspectExtensionDir,
} from '@dolphy-app/extension-host';
import { parseIndex } from '@dolphy-app/extension-catalog';
import type { CatalogIndex } from '@dolphy-app/extension-catalog';
import { BuildError, CatalogUsageError } from '../errors.ts';
import { createGithubChecker } from './github.ts';
import type { GithubUserChecker } from './github.ts';
import { RULES } from './rules.ts';
import type {
  CheckedManifest,
  DeclaredMetadata,
  Finding,
  RuleContext,
} from './rules.ts';
import { readTree } from './tree.ts';

export const SKIPPED_SOURCE_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  'dist-ext',
  '.dolphy',
  '.git',
]);

export interface CheckOptions {
  extensionsDir: string;
  /** Only these directories; unset — all subdirectories. */
  ids?: readonly string[];
  publishedIndex?: string;
  /** Site root with built versions `extensions/<id>/<version>/`; unset — the bundle rules are silent. */
  builtDir?: string;
  maxAppVersion?: string;
  skipGithubCheck?: boolean;
  checkGithubUser?: GithubUserChecker;
  githubToken?: string | undefined;
  fetch?: typeof fetch;
}

export interface CheckFinding extends Finding {
  extensionId: string;
  ruleId: string;
}

export const formatFinding = (finding: CheckFinding): string =>
  `${finding.severity} ${finding.extensionId} ${finding.ruleId} ${finding.field}: ${finding.message}`;

export const hasErrors = (findings: readonly CheckFinding[]): boolean =>
  findings.some((finding) => finding.severity === 'error');

const isMissing = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException).code === 'ENOENT';

export const loadIndexFile = async (
  file: string,
): Promise<CatalogIndex | null> => {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  try {
    return parseIndex(JSON.parse(text));
  } catch (error) {
    throw new BuildError(
      `${file} is not a valid catalog index: ${error instanceof Error ? error.message : String(error)}`,
      file,
    );
  }
};

const listExtensionDirs = async (root: string): Promise<string[]> => {
  const entries = await readdir(root, { withFileTypes: true }).catch(
    (error: unknown) => {
      throw new CatalogUsageError(
        `cannot read extensions directory: ${error instanceof Error ? error.message : String(error)}`,
        root,
      );
    },
  );
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
};

const selectDirs = async (options: CheckOptions): Promise<string[]> => {
  const all = await listExtensionDirs(options.extensionsDir);
  if (options.ids === undefined) return all;
  const missing = options.ids.filter((id) => !all.includes(id));
  if (missing.length > 0) {
    throw new CatalogUsageError(
      `no such extension directories: ${missing.join(', ')}`,
      options.extensionsDir,
    );
  }
  return [...options.ids].sort();
};

const readTextOrNull = async (file: string): Promise<string | null> => {
  const info = await stat(file).catch(() => null);
  return info?.isFile() === true ? readFile(file, 'utf8') : null;
};

/** A file inside `dir`; a path that leaves it (`../x`) is no file. */
const readBytesInside = async (
  dir: string,
  file: string,
): Promise<Uint8Array | null> => {
  const target = path.resolve(dir, file);
  if (!target.startsWith(dir + path.sep)) return null;
  const info = await stat(target).catch(() => null);
  return info?.isFile() === true ? readFile(target) : null;
};

const inspectManifest = async (
  dir: string,
): Promise<{ manifest: CheckedManifest | null; problem: string | null }> => {
  const result = await inspectExtensionDir(dir, {
    verifyFiles: false,
    expectedId: null,
  });
  return result.ok
    ? { manifest: result.extension, problem: null }
    : { manifest: null, problem: formatDiagnostic(result.diagnostic) };
};

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const readDeclared = async (dir: string): Promise<DeclaredMetadata | null> => {
  try {
    const raw: unknown = JSON.parse(
      await readFile(path.join(dir, 'extension.json'), 'utf8'),
    );
    if (typeof raw !== 'object' || raw === null) return null;
    const fields = raw as Record<string, unknown>;
    return {
      name: stringOrNull(fields.name),
      description: stringOrNull(fields.description),
      author: stringOrNull(fields.author),
      icon: stringOrNull(fields.icon),
    };
  } catch {
    return null;
  }
};

const contextFor = async (
  options: CheckOptions,
  dirName: string,
  published: CatalogIndex | null,
  checkGithubUser: GithubUserChecker,
): Promise<RuleContext> => {
  const dir = path.resolve(options.extensionsDir, dirName);
  const { manifest, problem } = await inspectManifest(dir);
  return {
    dirName,
    dir,
    manifest,
    declared: await readDeclared(dir),
    manifestProblem: problem,
    tree: await readTree(dir, SKIPPED_SOURCE_DIRS),
    bundleDir:
      options.builtDir === undefined || manifest === null
        ? null
        : path.join(
            path.resolve(options.builtDir),
            'extensions',
            manifest.id,
            manifest.version,
          ),
    readText: (file) => readTextOrNull(path.join(dir, file)),
    readBytes: (file) => readBytesInside(dir, file),
    published: published?.extensions.find(
      (entry) => entry.id === (manifest?.id ?? dirName),
    ),
    maxAppVersion: options.maxAppVersion ?? null,
    skipGithubCheck: options.skipGithubCheck === true,
    checkGithubUser,
  };
};

export const checkCatalog = async (
  options: CheckOptions,
): Promise<CheckFinding[]> => {
  const dirs = await selectDirs(options);
  const published =
    options.publishedIndex === undefined
      ? null
      : await loadIndexFile(options.publishedIndex);
  const checkGithubUser =
    options.checkGithubUser ??
    createGithubChecker({
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      token: options.githubToken,
    });
  const findings: CheckFinding[] = [];
  for (const dirName of dirs) {
    const context = await contextFor(
      options,
      dirName,
      published,
      checkGithubUser,
    );
    for (const rule of RULES) {
      for (const finding of await rule.run(context)) {
        findings.push({ ...finding, extensionId: dirName, ruleId: rule.id });
      }
    }
  }
  return findings;
};

export const listRules = (): string[] =>
  RULES.map((rule) => `${rule.id} ${rule.title}`);
