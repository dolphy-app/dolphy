import type { CatalogEntry, CatalogVersion, RevokedEntry } from './schema.ts';
import { compareSemver, satisfiesRange } from './semver.ts';

export interface ResolveContext {
  apiVersion: number;
  /** `undefined` — версия приложения неизвестна, проверка не выполняется. */
  appVersion: string | undefined;
  platform: string;
}

export type IncompatibleReason = 'platform' | 'api' | 'app';

export type Resolution =
  | { ok: true; version: CatalogVersion }
  | {
      ok: false;
      reason: IncompatibleReason;
      detail: string;
      fallback: CatalogVersion | null;
    };

interface Failure {
  reason: IncompatibleReason;
  detail: string;
}

const platformFailure = (
  entry: CatalogEntry,
  context: ResolveContext,
): Failure | null =>
  entry.platforms.length === 0 ||
  entry.platforms.some((p) => p === context.platform)
    ? null
    : {
        reason: 'platform',
        detail: `not available on ${context.platform}`,
      };

const versionFailure = (
  version: CatalogVersion,
  context: ResolveContext,
): Failure | null => {
  if (version.apiVersion !== context.apiVersion) {
    return {
      reason: 'api',
      detail: `requires extension API ${version.apiVersion}`,
    };
  }
  const { minAppVersion } = version;
  const { appVersion } = context;
  if (
    minAppVersion !== null &&
    appVersion !== undefined &&
    compareSemver(minAppVersion, appVersion) > 0
  ) {
    return { reason: 'app', detail: `requires app >= ${minAppVersion}` };
  }
  return null;
};

export const resolveVersion = (
  entry: CatalogEntry,
  context: ResolveContext,
): Resolution => {
  const platform = platformFailure(entry, context);
  const failures = entry.versions.map(
    (version) => platform ?? versionFailure(version, context),
  );
  const index = failures.findIndex((failure) => failure === null);
  const newest = entry.versions[0];
  if (index === 0 && newest !== undefined) return { ok: true, version: newest };
  const first = failures[0];
  if (first === null || first === undefined) {
    return { ok: false, reason: 'api', detail: 'no versions', fallback: null };
  }
  return {
    ok: false,
    reason: first.reason,
    detail: first.detail,
    fallback: index === -1 ? null : (entry.versions[index] ?? null),
  };
};

export const isRevoked = (
  revoked: readonly RevokedEntry[],
  id: string,
  version: string,
): RevokedEntry | null =>
  revoked.find(
    (entry) => entry.id === id && satisfiesRange(version, entry.versions),
  ) ?? null;

export const latestUpdate = (
  installedVersion: string,
  entry: CatalogEntry,
  context: ResolveContext,
): CatalogVersion | null => {
  const resolution = resolveVersion(entry, context);
  const candidate = resolution.ok ? resolution.version : resolution.fallback;
  return candidate !== null &&
    compareSemver(candidate.version, installedVersion) > 0
    ? candidate
    : null;
};
