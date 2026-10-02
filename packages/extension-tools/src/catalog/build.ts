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
import { parseManifest } from '@dolphy-app/extension-host';
import type { ExtensionManifest } from '@dolphy-app/extension-api';
import {
  CATALOG_FILE_EXTENSIONS,
  MAX_FILES,
  MAX_TOTAL_BYTES,
  isSafeCatalogPath,
} from '@dolphy-app/extension-catalog';
import type {
  CatalogEntry,
  CatalogFile,
  CatalogIndex,
  CatalogVersion,
} from '@dolphy-app/extension-catalog';
import { buildExtension } from '../index.ts';
import { BuildError, CatalogUsageError } from '../errors.ts';
import { loadIndexFile } from './check.ts';
import {
  INDEX_FILE,
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
  /** Каталог с проектами `<src>/<id>`. */
  src: string;
  ids: readonly string[];
  /** Корень сайта: `index.json` и `extensions/<id>/<version>/`. */
  out: string;
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
  if (files.length > MAX_FILES) {
    problems.push(`${files.length} files exceed the limit of ${MAX_FILES}`);
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
  if (!parsed.ok) throw new BuildError(parsed.message, dir);
  return parsed.manifest;
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
  return {
    id,
    dir: built.dir,
    manifest: await readBuiltManifest(built.dir),
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

const newRecord = (staged: Staged, publishedAt: string): CatalogVersion => ({
  version: staged.manifest.version,
  apiVersion: staged.manifest.apiVersion,
  minAppVersion: staged.manifest.minAppVersion,
  permissions: [...staged.manifest.permissions],
  publishedAt,
  baseUrl: baseUrlOf(staged),
  files: staged.files,
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
    },
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

/** Собирает версии расширений и обновляет `index.json`; при ошибке на диск ничего не пишется. */
export const buildCatalog = async (
  options: BuildCatalogOptions,
): Promise<PublishResult[]> => {
  const out = path.resolve(options.out);
  const now = (options.now ?? (() => new Date()))().toISOString();
  const publishedAt = options.publishedAt ?? now;
  const sourceBase = options.sourceBase ?? DEFAULT_SOURCE_BASE;
  const previous = await loadIndexFile(
    path.resolve(options.previousIndex ?? path.join(out, INDEX_FILE)),
  );
  const revoked = await loadRevoked(options.revoked, previous);
  const scratch = await mkdtemp(path.join(tmpdir(), 'dolphy-catalog-'));
  try {
    const plans: Plan[] = [];
    const entries = new Map<string, CatalogEntry>(
      (previous?.extensions ?? []).map((entry) => [entry.id, entry]),
    );
    for (const id of options.ids) {
      const staged = await stage(options, id, scratch);
      requirePublication(staged);
      const before = entries.get(id);
      const item = await plan(staged, out, before, publishedAt);
      plans.push(item);
      entries.set(id, entryOf(item, before, sourceBase));
    }
    const index = assembleIndex({
      generatedAt: now,
      extensions: [...entries.values()],
      revoked,
    });
    for (const item of plans) {
      if (item.shouldWrite) await writeVersion(item, out);
    }
    await mkdir(out, { recursive: true });
    const indexFile = path.join(out, INDEX_FILE);
    if (!hasSameContent(await loadIndexFile(indexFile), index)) {
      await writeIndexAtomically(indexFile, index);
    }
    return plans.map(resultOf);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
};

export interface ReindexOptions {
  out: string;
  previousIndex?: string;
  revoked?: string;
  /** Значение `generatedAt`; по умолчанию сейчас. */
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

/** Перезаписывает `revoked` и `generatedAt` существующего индекса; записи расширений не меняются. */
export const reindexCatalog = async (
  options: ReindexOptions,
): Promise<ReindexResult> => {
  const out = path.resolve(options.out);
  const source = path.resolve(
    options.previousIndex ?? path.join(out, INDEX_FILE),
  );
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
  const indexFile = path.join(out, INDEX_FILE);
  const changed = !hasSameContent(await loadIndexFile(indexFile), index);
  if (changed) {
    await mkdir(out, { recursive: true });
    await writeIndexAtomically(indexFile, index);
  }
  return {
    extensions: index.extensions.length,
    revoked: index.revoked.length,
    changed,
  };
};
