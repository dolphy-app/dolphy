import type {
  CatalogEntryDto,
  CatalogListedVersionDto,
  CatalogVersionDto,
  DeprecationDto,
} from '@dolphy-app/engine-contract';
import {
  compareSemver,
  deprecationFor,
  isSemver,
  resolveVersion,
} from '@dolphy-app/extension-catalog';
import type {
  CatalogEntry,
  CatalogVersion,
  Deprecation,
  ResolveContext,
} from '@dolphy-app/extension-catalog';

export const CHANGELOG_FILE = 'CHANGELOG.md';

export const totalSize = (version: CatalogVersion): number =>
  version.files.reduce((sum, file) => sum + file.size, 0);

export const toVersionDto = (version: CatalogVersion): CatalogVersionDto => ({
  version: version.version,
  permissions: [...version.permissions],
  publishedAt: version.publishedAt,
  size: totalSize(version),
  minAppVersion: version.minAppVersion,
});

/** Название записи индекса по id; `null` — записи нет. */
export type NameOf = (id: string) => string | null;

export const toDeprecationDto = (
  deprecated: Deprecation,
  nameOf: NameOf,
): DeprecationDto => ({
  versions: deprecated.versions,
  reason: deprecated.reason,
  alternatives: deprecated.alternatives.map((id) => ({
    id,
    name: nameOf(id),
  })),
});

/** Версия в списке версий записи: можно ли её установить сейчас, почему нет, есть ли журнал изменений. */
const toListedVersion = (
  entry: CatalogEntry,
  version: CatalogVersion,
  context: ResolveContext,
): CatalogListedVersionDto => {
  const resolution = resolveVersion({ ...entry, versions: [version] }, context);
  return {
    ...toVersionDto(version),
    compatible: resolution.ok,
    incompatible: resolution.ok
      ? null
      : { reason: resolution.reason, detail: resolution.detail },
    hasChangelog: version.files.some((file) => file.path === CHANGELOG_FILE),
  };
};

/** `installed` — и когда установленная версия новее каталожной или не semver: обновлять нечего. */
const compatibleStatus = (
  installedVersion: string | null,
  latest: string,
): CatalogEntryDto['status'] => {
  if (installedVersion === null) return 'available';
  const older =
    isSemver(installedVersion) && compareSemver(installedVersion, latest) < 0;
  return older ? 'update' : 'installed';
};

export interface DescribeExtras {
  /** Расширение с этим id уже есть, но установлено не из этого каталога. */
  elsewhere: boolean;
  nameOf: NameOf;
}

export const describeEntry = (
  entry: CatalogEntry,
  context: ResolveContext,
  installedVersion: string | null,
  extras: DescribeExtras,
): CatalogEntryDto => {
  const resolution = resolveVersion(entry, context);
  const shown = resolution.ok ? resolution.version : entry.versions[0];
  const deprecated =
    shown === undefined ? null : deprecationFor(entry, shown.version);
  const common = {
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
      settings: [...(entry.contributes.settings ?? [])],
      events: [...(entry.contributes.events ?? [])],
      commands: [...(entry.contributes.commands ?? [])],
      panels: [...(entry.contributes.panels ?? [])],
      widgets: [...(entry.contributes.widgets ?? [])],
      schedules: [...(entry.contributes.schedules ?? [])],
      importers: [...(entry.contributes.importers ?? [])],
      exporters: [...(entry.contributes.exporters ?? [])],
    },
    icon: shown?.icon ?? null,
    titles: structuredClone(entry.titles ?? {}),
    tags: [...(shown?.tags ?? [])],
    installedVersion,
    versions: entry.versions.map((version) =>
      toListedVersion(entry, version, context),
    ),
    deprecated:
      deprecated === null ? null : toDeprecationDto(deprecated, extras.nameOf),
    elsewhere: extras.elsewhere,
  };
  if (!resolution.ok) {
    return {
      ...common,
      status: 'incompatible',
      latest: null,
      incompatible: {
        reason: resolution.reason,
        detail: resolution.detail,
        fallback:
          resolution.fallback === null
            ? null
            : toVersionDto(resolution.fallback),
      },
    };
  }
  return {
    ...common,
    status: compatibleStatus(installedVersion, resolution.version.version),
    latest: toVersionDto(resolution.version),
    incompatible: null,
  };
};
