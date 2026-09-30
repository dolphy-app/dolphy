import type {
  CatalogEntryDto,
  CatalogVersionDto,
} from '@spirula-app/engine-contract';
import {
  compareSemver,
  isSemver,
  resolveVersion,
} from '@spirula-app/extension-catalog';
import type {
  CatalogEntry,
  CatalogVersion,
  ResolveContext,
} from '@spirula-app/extension-catalog';

export const totalSize = (version: CatalogVersion): number =>
  version.files.reduce((sum, file) => sum + file.size, 0);

export const toVersionDto = (version: CatalogVersion): CatalogVersionDto => ({
  version: version.version,
  permissions: [...version.permissions],
  publishedAt: version.publishedAt,
  size: totalSize(version),
  minAppVersion: version.minAppVersion,
});

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

export const describeEntry = (
  entry: CatalogEntry,
  context: ResolveContext,
  installedVersion: string | null,
): CatalogEntryDto => {
  const resolution = resolveVersion(entry, context);
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
    },
    installedVersion,
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
