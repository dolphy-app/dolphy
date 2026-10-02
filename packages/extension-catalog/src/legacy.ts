import {
  LEGACY_SCHEMA_VERSION,
  MAX_FILES,
  isLegacyCatalogPath,
} from './schema.ts';
import type { CatalogEntry, CatalogIndex, CatalogVersion } from './schema.ts';

/** Permissions the released apps know: a catalog with any other value is rejected whole by them. */
export const LEGACY_PERMISSIONS: readonly string[] = [
  'library.read',
  'process.spawn',
  'worker.threads',
  'native.addons',
  'network',
];

/** Contribution lists the released apps do not know (`contributes.settings` and later). */
const NEWER_CONTRIBUTION_KEYS = [
  'settings',
  'events',
  'commands',
  'panels',
] as const;

/** Whether a released app can parse the entry's summary of contributions. */
export const isLegacyEntry = (entry: CatalogEntry): boolean =>
  NEWER_CONTRIBUTION_KEYS.every((key) => entry.contributes[key] === undefined);

/**
 * Whether a released app can parse the version: only first-format file types,
 * at most `MAX_FILES` files, no `icon`, only permissions it knows.
 */
export const isLegacyVersion = (version: CatalogVersion): boolean =>
  version.icon === undefined &&
  version.files.length <= MAX_FILES &&
  version.files.every((file) => isLegacyCatalogPath(file.path)) &&
  version.permissions.every((permission) =>
    LEGACY_PERMISSIONS.includes(permission),
  );

/**
 * The part of the full index that every released app parses: versions and entries
 * they cannot read are left out, an extension left without versions is skipped.
 * The revocation list is kept whole.
 */
export const legacySubset = (index: CatalogIndex): CatalogIndex => ({
  ...index,
  schemaVersion: LEGACY_SCHEMA_VERSION,
  extensions: index.extensions
    .filter(isLegacyEntry)
    .map((entry) => ({
      ...entry,
      versions: entry.versions.filter(isLegacyVersion),
    }))
    .filter((entry) => entry.versions.length > 0),
});
