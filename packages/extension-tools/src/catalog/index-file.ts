import { rename, writeFile } from 'node:fs/promises';
import {
  CATALOG_SCHEMA_VERSION,
  FULL_INDEX_FILE,
  MAX_VERSIONS,
  TITLED_POINTS,
  compareSemver,
  parseIndex,
} from '@dolphy-app/extension-catalog';
import type {
  CatalogEntry,
  CatalogFile,
  CatalogIndex,
  CatalogVersion,
  ContributionTitles,
} from '@dolphy-app/extension-catalog';
import { BuildError } from '../errors.ts';
import { compareText } from './tree.ts';

export { FULL_INDEX_FILE };

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
  ...(version.icon === undefined ? {} : { icon: version.icon }),
  ...(version.tags === undefined || version.tags.length === 0
    ? {}
    : { tags: [...version.tags] }),
});

type OptionalKey =
  | 'settings'
  | 'events'
  | 'commands'
  | 'panels'
  | 'widgets'
  | 'schedules'
  | 'importers'
  | 'exporters';

const optionalIds = (
  key: OptionalKey,
  ids: readonly string[] | undefined,
): Partial<Record<OptionalKey, string[]>> =>
  ids === undefined || ids.length === 0 ? {} : { [key]: [...ids] };

const orderTitles = (
  titles: ContributionTitles | undefined,
): { titles?: ContributionTitles } => {
  const ordered: ContributionTitles = {};
  for (const point of TITLED_POINTS) {
    const map = titles?.[point];
    if (map !== undefined && Object.keys(map).length > 0) {
      ordered[point] = { ...map };
    }
  }
  return Object.keys(ordered).length > 0 ? { titles: ordered } : {};
};

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
    ...optionalIds('settings', entry.contributes.settings),
    ...optionalIds('events', entry.contributes.events),
    ...optionalIds('commands', entry.contributes.commands),
    ...optionalIds('panels', entry.contributes.panels),
    ...optionalIds('widgets', entry.contributes.widgets),
    ...optionalIds('schedules', entry.contributes.schedules),
    ...optionalIds('importers', entry.contributes.importers),
    ...optionalIds('exporters', entry.contributes.exporters),
  },
  ...orderTitles(entry.titles),
  ...(entry.deprecated === undefined
    ? {}
    : {
        deprecated: {
          versions: entry.deprecated.versions,
          reason: entry.deprecated.reason,
          alternatives: [...entry.deprecated.alternatives],
        },
      }),
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

const checked = (candidate: CatalogIndex): CatalogIndex => {
  try {
    parseIndex(candidate);
    return candidate;
  } catch (error) {
    throw new BuildError(
      `resulting index is invalid: ${error instanceof Error ? error.message : String(error)}`,
      FULL_INDEX_FILE,
    );
  }
};

/** Builds the index with a stable key order; throws `BuildError` if it fails `parseIndex`. */
export const assembleIndex = (parts: IndexParts): CatalogIndex => {
  const candidate: CatalogIndex = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    generatedAt: parts.generatedAt,
    extensions: [...parts.extensions].sort(byId).map(orderEntry),
    revoked: parts.revoked.map((item) => ({
      id: item.id,
      versions: item.versions,
      reason: item.reason,
    })),
  };
  return checked(candidate);
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

/** Whether entries and the revocation list match (ignoring `generatedAt`). */
export const hasSameContent = (
  current: CatalogIndex | null,
  next: CatalogIndex,
): boolean => current !== null && contentOf(current) === contentOf(next);
