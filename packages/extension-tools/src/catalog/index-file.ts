import { rename, writeFile } from 'node:fs/promises';
import {
  MAX_VERSIONS,
  compareSemver,
  parseIndex,
} from '@spirula-app/extension-catalog';
import type {
  CatalogEntry,
  CatalogFile,
  CatalogIndex,
  CatalogVersion,
} from '@spirula-app/extension-catalog';
import { BuildError } from '../errors.ts';
import { compareText } from './tree.ts';

export const INDEX_FILE = 'index.json';

const orderFile = (file: CatalogFile): CatalogFile => ({
  path: file.path,
  size: file.size,
  sha256: file.sha256,
});

const byPath = (a: CatalogFile, b: CatalogFile): number =>
  compareText(a.path, b.path);

export const sameFiles = (
  a: readonly CatalogFile[],
  b: readonly CatalogFile[],
): boolean =>
  JSON.stringify([...a].sort(byPath).map(orderFile)) ===
  JSON.stringify([...b].sort(byPath).map(orderFile));

const orderVersion = (version: CatalogVersion): CatalogVersion => ({
  version: version.version,
  apiVersion: version.apiVersion,
  minAppVersion: version.minAppVersion,
  permissions: [...version.permissions],
  publishedAt: version.publishedAt,
  baseUrl: version.baseUrl,
  files: [...version.files].sort(byPath).map(orderFile),
});

const orderEntry = (entry: CatalogEntry): CatalogEntry => ({
  id: entry.id,
  name: entry.name,
  description: entry.description,
  author: entry.author,
  source: entry.source,
  platforms: [...entry.platforms],
  contributes: {
    exerciseTypes: [...entry.contributes.exerciseTypes],
    themes: [...entry.contributes.themes],
    markdownRenderers: [...entry.contributes.markdownRenderers],
    gradePolicies: [...entry.contributes.gradePolicies],
  },
  versions: entry.versions.map(orderVersion),
});

const byId = (a: CatalogEntry, b: CatalogEntry): number =>
  compareText(a.id, b.id);

export const newestFirst = (versions: readonly CatalogVersion[]) =>
  [...versions]
    .sort((a, b) => compareSemver(b.version, a.version))
    .slice(0, MAX_VERSIONS);

export interface IndexParts {
  generatedAt: string;
  extensions: readonly CatalogEntry[];
  revoked: CatalogIndex['revoked'];
}

/** Собирает индекс в стабильном порядке ключей; бросает `BuildError`, если он не проходит `parseIndex`. */
export const assembleIndex = (parts: IndexParts): CatalogIndex => {
  const candidate: CatalogIndex = {
    schemaVersion: 1,
    generatedAt: parts.generatedAt,
    extensions: [...parts.extensions].sort(byId).map(orderEntry),
    revoked: parts.revoked.map((item) => ({
      id: item.id,
      versions: item.versions,
      reason: item.reason,
    })),
  };
  try {
    parseIndex(candidate);
    return candidate;
  } catch (error) {
    throw new BuildError(
      `resulting index is invalid: ${error instanceof Error ? error.message : String(error)}`,
      INDEX_FILE,
    );
  }
};

export const writeIndexAtomically = async (
  file: string,
  index: CatalogIndex,
): Promise<void> => {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(index, null, 2)}\n`);
  await rename(temporary, file);
};

const contentOf = (index: CatalogIndex): string => {
  const { extensions, revoked } = assembleIndex({
    generatedAt: index.generatedAt,
    extensions: index.extensions,
    revoked: index.revoked,
  });
  return JSON.stringify({ extensions, revoked });
};

/** Совпадают ли записи и список отзыва (без `generatedAt`). */
export const hasSameContent = (
  current: CatalogIndex | null,
  next: CatalogIndex,
): boolean => current !== null && contentOf(current) === contentOf(next);
