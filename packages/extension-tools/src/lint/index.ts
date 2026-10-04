import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildExtension } from '../index.ts';
import { CatalogUsageError } from '../errors.ts';
import { MANIFEST_FILE } from '../project.ts';
import { bundleFindings, readBundleFiles } from './bundle.ts';
import { manifestFindings } from './manifest.ts';
import type { RuleFinding } from './manifest.ts';

export { bundleFindings, readBundleFiles } from './bundle.ts';
export type { BundleFile } from './bundle.ts';
export {
  MIN_DESCRIPTION_LENGTH,
  manifestFindings,
  shortDescription,
} from './manifest.ts';
export type { DeclaredFields, RuleFinding } from './manifest.ts';

export interface LintOptions {
  /** Project directory. */
  root: string;
  /** A directory of an already built extension; unset — build into a temporary directory. */
  built?: string;
}

export interface LintFinding extends RuleFinding {
  extensionId: string;
}

export const formatLintFinding = (finding: LintFinding): string =>
  `${finding.severity} ${finding.extensionId} ${finding.ruleId} ${finding.field}: ${finding.message}`;

export const lintHasErrors = (findings: readonly LintFinding[]): boolean =>
  findings.some((finding) => finding.severity === 'error');

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const stringsOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

const readManifest = async (root: string): Promise<Record<string, unknown>> => {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path.join(root, MANIFEST_FILE), 'utf8'));
  } catch (error) {
    throw new CatalogUsageError(
      `${MANIFEST_FILE} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      root,
    );
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new CatalogUsageError(`${MANIFEST_FILE} is not an object`, root);
  }
  return raw as Record<string, unknown>;
};

const isDirectory = async (dir: string): Promise<boolean> =>
  (await stat(dir).catch(() => null))?.isDirectory() === true;

/** Code files of the build the author is going to publish. */
const builtFiles = async (options: LintOptions) => {
  if (options.built !== undefined) return readBundleFiles(options.built);
  const temp = await mkdtemp(path.join(tmpdir(), 'dolphy-lint-'));
  try {
    const { dir } = await buildExtension({
      root: options.root,
      outDir: temp,
    });
    return await readBundleFiles(dir);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
};

/**
 * Checks a project the way `catalog check` checks it, before a pull request:
 * manifest metadata, README and the built code. Everything is a warning
 * except a missing README and an embedded source map.
 */
export const lintProject = async (
  options: LintOptions,
): Promise<LintFinding[]> => {
  const root = path.resolve(options.root);
  if (!(await isDirectory(root))) {
    throw new CatalogUsageError('not a directory', root);
  }
  if (options.built !== undefined && !(await isDirectory(options.built))) {
    throw new CatalogUsageError('--built: not a directory', options.built);
  }
  const manifest = await readManifest(root);
  const extensionId = stringOrNull(manifest.id) ?? path.basename(root);
  const findings: RuleFinding[] = manifestFindings({
    name: stringOrNull(manifest.name),
    description: stringOrNull(manifest.description),
    author: stringOrNull(manifest.author),
    tags: Array.isArray(manifest.tags) ? manifest.tags : null,
  });
  const readme = await readFile(path.join(root, 'README.md'), 'utf8').catch(
    () => null,
  );
  if (readme === null || readme.trim() === '') {
    findings.push({
      ruleId: 'CHECK-004',
      severity: 'error',
      field: 'README.md',
      message: 'README.md is missing or empty',
    });
  }
  const files = await builtFiles(
    options.built === undefined
      ? { root }
      : { root, built: path.resolve(options.built) },
  );
  findings.push(...bundleFindings(files, stringsOf(manifest.permissions)));
  return findings.map((finding) => ({
    ...finding,
    // the source map is a catalog error, but the author fixes it before the PR
    severity: finding.ruleId === 'CHECK-004' ? 'error' : 'warning',
    extensionId,
  }));
};
