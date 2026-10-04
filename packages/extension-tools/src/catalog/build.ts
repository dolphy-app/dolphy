import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { formatDiagnostic, parseManifest } from '@dolphy-app/extension-host';
import type { ExtensionManifest } from '@dolphy-app/extension-api';
import {
  CATALOG_FILE_EXTENSIONS,
  MAX_FILES_V2,
  MAX_TOTAL_BYTES,
  TITLED_POINTS,
  iconDataUri,
  iconProblem,
  isSafeCatalogPath,
  sizeProblem,
} from '@dolphy-app/extension-catalog';
import type {
  CatalogEntry,
  CatalogFile,
  CatalogIndex,
  CatalogVersion,
  ContributionTitles,
  TitledPoint,
} from '@dolphy-app/extension-catalog';
import { buildExtension } from '../index.ts';
import { BuildError, CatalogUsageError } from '../errors.ts';
import { loadIndexFile } from './check.ts';
import {
  FULL_INDEX_FILE,
  assembleIndex,
  hasSameContent,
  newestFirst,
  sameFiles,
  writeIndexAtomically,
} from './index-file.ts';
import { hashTree, readTree } from './tree.ts';

export const DEFAULT_SOURCE_BASE =
  'https://github.com/dolphy-app/dolphy-extensions/tree/main/extensions';

export interface BuildCatalogOptions {
  /** Directory of projects `<src>/<id>`. */
  src: string;
  ids: readonly string[];
  /** Site root: `index.v2.json` and `extensions/<id>/<version>/`. */
  out: string;
  /** Source index; default `<out>/index.v2.json`. */
  previousIndex?: string;
  revoked?: string;
  sourceBase?: string;
  publishedAt?: string;
  now?: () => Date;
}

export interface PublishResult {
  id: string;
  version: string;
  status: 'published' | 'unchanged';
  files: number;
  bytes: number;
}

interface Staged {
  id: string;
  dir: string;
  manifest: ExtensionManifest;
  files: CatalogFile[];
  /** The manifest icon as a `data:` URI. */
  icon: string | null;
}

type Revoked = CatalogIndex['revoked'];

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const README = 'README.md';

const copyReadme = async (srcDir: string, dir: string, id: string) => {
  const text = await readFile(path.join(srcDir, README), 'utf8').catch(
    () => '',
  );
  if (text.trim() === '')
    throw new BuildError(`${README} is missing or empty`, id);
  await writeFile(path.join(dir, README), text);
};

const fileProblems = (files: readonly CatalogFile[]): string[] => {
  const problems = files
    .filter((file) => !isSafeCatalogPath(file.path))
    .map(
      (file) =>
        `'${file.path}' is not allowed (extensions ${CATALOG_FILE_EXTENSIONS.join('|')}, safe path segments)`,
    );
  if (files.length > MAX_FILES_V2) {
    problems.push(`${files.length} files exceed the limit of ${MAX_FILES_V2}`);
  }
  for (const file of files) {
    const problem = sizeProblem(file.path, file.size);
    if (problem !== null) problems.push(problem);
  }
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_TOTAL_BYTES) {
    problems.push(`${total} bytes exceed the limit of ${MAX_TOTAL_BYTES}`);
  }
  return problems;
};

const readBuiltManifest = async (dir: string): Promise<ExtensionManifest> => {
  const parsed = parseManifest(
    JSON.parse(await readFile(path.join(dir, 'extension.json'), 'utf8')),
  );
  if (!parsed.ok)
    throw new BuildError(formatDiagnostic(parsed.diagnostic), dir);
  return parsed.manifest;
};

/** The icon declared in the manifest, read from the built directory; its checks ran in `buildExtension`. */
const readIcon = async (
  dir: string,
  manifest: ExtensionManifest,
  id: string,
): Promise<string | null> => {
  if (manifest.icon === null) return null;
  const bytes = await readFile(path.join(dir, manifest.icon));
  const problem = iconProblem(manifest.icon, bytes);
  if (problem !== null) throw new BuildError(problem, id);
  return iconDataUri(manifest.icon, bytes);
};

const stage = async (
  options: BuildCatalogOptions,
  id: string,
  scratch: string,
): Promise<Staged> => {
  const srcDir = path.resolve(options.src, id);
  const built = await buildExtension({ root: srcDir, outDir: scratch });
  if (built.id !== id) {
    throw new BuildError(
      `directory name '${id}' does not match manifest id '${built.id}'`,
      id,
    );
  }
  await copyReadme(srcDir, built.dir, id);
  const tree = await readTree(built.dir);
  const files = await hashTree(built.dir, tree.files);
  const problems = [
    ...tree.symlinks.map((link) => `'${link}' is a symbolic link`),
    ...fileProblems(files),
  ];
  if (problems.length > 0) throw new BuildError(problems.join('; '), id);
  const manifest = await readBuiltManifest(built.dir);
  return {
    id,
    dir: built.dir,
    manifest,
    icon: await readIcon(built.dir, manifest, id),
    files: files.map(({ path: file, size, sha256 }) => ({
      path: file,
      size,
      sha256,
    })),
  };
};

const requirePublication = (staged: Staged): void => {
  const { name, description, author } = staged.manifest;
  const missing = Object.entries({ name, description, author })
    .filter(([, value]) => value === null || value.trim() === '')
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new BuildError(
      `manifest lacks publication metadata: ${missing.join(', ')}`,
      staged.id,
    );
  }
};

const versionDir = (out: string, staged: Staged): string =>
  path.join(out, 'extensions', staged.id, staged.manifest.version);

const baseUrlOf = (staged: Staged): string =>
  `extensions/${staged.id}/${staged.manifest.version}/`;

const existingFiles = async (dir: string): Promise<CatalogFile[] | null> => {
  const info = await stat(dir).catch(() => null);
  if (info === null) return null;
  const tree = await readTree(dir);
  if (tree.symlinks.length > 0) return [];
  const hashed = await hashTree(dir, tree.files);
  return hashed.map(({ path: file, size, sha256 }) => ({
    path: file,
    size,
    sha256,
  }));
};

interface Plan {
  staged: Staged;
  record: CatalogVersion;
  status: PublishResult['status'];
  shouldWrite: boolean;
}

const immutabilityError = (staged: Staged): BuildError =>
  new BuildError(
    `version ${staged.manifest.version} is already published with different content; published versions never change`,
    staged.id,
  );

/** `label`/`title` of the manifest contributions by point; points without contributions are left out. */
const titlesOf = (manifest: Staged['manifest']): ContributionTitles => {
  const { contributes } = manifest;
  const byPoint: Record<TitledPoint, { id: string; title: string }[]> = {
    themes: contributes.themes.map(({ id, label }) => ({ id, title: label })),
    gradePolicies: contributes.gradePolicies.map(({ id, label }) => ({
      id,
      title: label,
    })),
    settings: contributes.settings.map(({ id, label }) => ({
      id,
      title: label,
    })),
    commands: contributes.commands.map(({ id, title }) => ({ id, title })),
    panels: contributes.panels.map(({ id, title }) => ({ id, title })),
  };
  return Object.fromEntries(
    TITLED_POINTS.filter((point) => byPoint[point].length > 0).map((point) => [
      point,
      Object.fromEntries(byPoint[point].map(({ id, title }) => [id, title])),
    ]),
  );
};

const newRecord = (staged: Staged, publishedAt: string): CatalogVersion => ({
  version: staged.manifest.version,
  apiVersion: staged.manifest.apiVersion,
  minAppVersion: staged.manifest.minAppVersion,
  permissions: [...staged.manifest.permissions],
  publishedAt,
  baseUrl: baseUrlOf(staged),
  files: staged.files,
  ...(staged.icon === null ? {} : { icon: staged.icon }),
  ...(staged.manifest.tags.length === 0
    ? {}
    : { tags: [...staged.manifest.tags] }),
});

const plan = async (
  staged: Staged,
  out: string,
  previous: CatalogEntry | undefined,
  publishedAt: string,
): Promise<Plan> => {
  const onDisk = await existingFiles(versionDir(out, staged));
  const recorded = previous?.versions.find(
    (item) => item.version === staged.manifest.version,
  );
  if (onDisk !== null && !sameFiles(onDisk, staged.files)) {
    throw immutabilityError(staged);
  }
  if (recorded !== undefined && !sameFiles(recorded.files, staged.files)) {
    throw immutabilityError(staged);
  }
  const isPublished = onDisk !== null && recorded !== undefined;
  return {
    staged,
    record: recorded ?? newRecord(staged, publishedAt),
    status: isPublished ? 'unchanged' : 'published',
    shouldWrite: onDisk === null,
  };
};

const entryOf = (
  item: Plan,
  previous: CatalogEntry | undefined,
  sourceBase: string,
): CatalogEntry => {
  const { staged, record } = item;
  const { manifest } = staged;
  const others = (previous?.versions ?? []).filter(
    (version) => version.version !== record.version,
  );
  const settings = manifest.contributes.settings.map((setting) => setting.id);
  const events = manifest.contributes.events.map((item) => item.event);
  const commands = manifest.contributes.commands.map(({ id }) => id);
  const panels = manifest.contributes.panels.map(({ id }) => id);
  const titles = titlesOf(manifest);
  return {
    id: staged.id,
    name: manifest.name ?? '',
    description: manifest.description ?? '',
    author: manifest.author ?? '',
    source: `${sourceBase.replace(/\/+$/, '')}/${staged.id}`,
    platforms: [...manifest.platforms],
    contributes: {
      exerciseTypes: manifest.contributes.exerciseTypes.map((type) => type.id),
      themes: manifest.contributes.themes.map((theme) => theme.id),
      markdownRenderers: manifest.contributes.markdownRenderers.map(
        (renderer) => renderer.language,
      ),
      gradePolicies: manifest.contributes.gradePolicies.map(
        (policy) => policy.id,
      ),
      ...(settings.length > 0 ? { settings } : {}),
      ...(events.length > 0 ? { events } : {}),
      ...(commands.length > 0 ? { commands } : {}),
      ...(panels.length > 0 ? { panels } : {}),
    },
    ...(Object.keys(titles).length > 0 ? { titles } : {}),
    versions: newestFirst([record, ...others]),
  };
};

const loadRevoked = async (
  file: string | undefined,
  previous: CatalogIndex | null,
): Promise<Revoked> => {
  if (file === undefined) return previous?.revoked ?? [];
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new BuildError(
      `revoked list is unreadable: ${errorText(error)}`,
      file,
    );
  }
  if (!Array.isArray(raw)) {
    throw new BuildError('revoked list must be a JSON array', file);
  }
  return raw as Revoked;
};

const writeVersion = async (item: Plan, out: string): Promise<void> => {
  const target = versionDir(out, item.staged);
  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await rm(temporary, { recursive: true, force: true });
  await cp(item.staged.dir, temporary, { recursive: true });
  await rename(temporary, target);
};

const resultOf = (item: Plan): PublishResult => ({
  id: item.staged.id,
  version: item.staged.manifest.version,
  status: item.status,
  files: item.staged.files.length,
  bytes: item.staged.files.reduce((sum, file) => sum + file.size, 0),
});

export const formatPublishResult = (result: PublishResult): string =>
  result.status === 'unchanged'
    ? `unchanged ${result.id}@${result.version}`
    : `published ${result.id}@${result.version} (${result.files} files, ${result.bytes} bytes)`;

/** The index to start from: the explicit file, else the index of the site. */
const previousIndexFile = async (
  out: string,
  explicit: string | undefined,
): Promise<string> =>
  explicit === undefined
    ? path.join(out, FULL_INDEX_FILE)
    : path.resolve(explicit);

/** Writes `index.v2.json` when it differs from the disk (ignoring `generatedAt`). */
const writeIndex = async (
  out: string,
  index: CatalogIndex,
): Promise<boolean> => {
  const file = path.join(out, FULL_INDEX_FILE);
  if (hasSameContent(await loadIndexFile(file), index)) return false;
  await mkdir(out, { recursive: true });
  await writeIndexAtomically(file, index);
  return true;
};

/** Builds extension versions and updates `index.v2.json`; on error nothing is written to disk. */
export const buildCatalog = async (
  options: BuildCatalogOptions,
): Promise<PublishResult[]> => {
  const out = path.resolve(options.out);
  const now = (options.now ?? (() => new Date()))().toISOString();
  const publishedAt = options.publishedAt ?? now;
  const sourceBase = options.sourceBase ?? DEFAULT_SOURCE_BASE;
  const previous = await loadIndexFile(
    await previousIndexFile(out, options.previousIndex),
  );
  const revoked = await loadRevoked(options.revoked, previous);
  const scratch = await mkdtemp(path.join(tmpdir(), 'dolphy-catalog-'));
  try {
    const plans: Plan[] = [];
    const results: PublishResult[] = [];
    const entries = new Map<string, CatalogEntry>(
      (previous?.extensions ?? []).map((entry) => [entry.id, entry]),
    );
    for (const id of options.ids) {
      const staged = await stage(options, id, scratch);
      requirePublication(staged);
      const before = entries.get(id);
      const item = await plan(staged, out, before, publishedAt);
      plans.push(item);
      const entry = entryOf(item, before, sourceBase);
      entries.set(id, entry);
      results.push(resultOf(item));
    }
    const index = assembleIndex({
      generatedAt: now,
      extensions: [...entries.values()],
      revoked,
    });
    for (const item of plans) {
      if (item.shouldWrite) await writeVersion(item, out);
    }
    await writeIndex(out, index);
    return results;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
};

export interface ReindexOptions {
  out: string;
  previousIndex?: string;
  revoked?: string;
  /** Value of `generatedAt`; defaults to now. */
  publishedAt?: string;
  now?: () => Date;
}

export interface ReindexResult {
  extensions: number;
  revoked: number;
  changed: boolean;
}

export const formatReindexResult = (result: ReindexResult): string =>
  `reindexed (${result.extensions} extensions, ${result.revoked} revoked)${result.changed ? '' : ' — no changes'}`;

/** Rewrites `revoked` and `generatedAt` of the index; extension entries are unchanged. */
export const reindexCatalog = async (
  options: ReindexOptions,
): Promise<ReindexResult> => {
  const out = path.resolve(options.out);
  const source = await previousIndexFile(out, options.previousIndex);
  const previous = await loadIndexFile(source);
  if (previous === null) {
    throw new CatalogUsageError(
      `nothing to reindex: ${source} does not exist`,
      source,
    );
  }
  const index = assembleIndex({
    generatedAt:
      options.publishedAt ??
      (options.now ?? (() => new Date()))().toISOString(),
    extensions: previous.extensions,
    revoked: await loadRevoked(options.revoked, previous),
  });
  const changed = await writeIndex(out, index);
  return {
    extensions: index.extensions.length,
    revoked: index.revoked.length,
    changed,
  };
};
