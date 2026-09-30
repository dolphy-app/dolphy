import {
  minAppVersionFailure,
  platformFailure,
  type CompatibilityContext,
} from './compat.ts';
import type { CatalogEntry, CatalogVersion, RevokedEntry } from './schema.ts';
import { compareSemver, satisfiesRange } from './semver.ts';

export interface ResolveContext extends CompatibilityContext {
  apiVersion: number;
  /** Отозванные версии (`index.revoked`): такая версия никогда не выбирается. */
  revoked?: readonly RevokedEntry[];
}

export type IncompatibleReason = 'platform' | 'api' | 'app' | 'revoked';

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

export const isRevoked = (
  revoked: readonly RevokedEntry[],
  id: string,
  version: string,
): RevokedEntry | null =>
  revoked.find(
    (entry) => entry.id === id && satisfiesRange(version, entry.versions),
  ) ?? null;

const versionFailure = (
  entry: CatalogEntry,
  version: CatalogVersion,
  context: ResolveContext,
): Failure | null => {
  const revoked = isRevoked(context.revoked ?? [], entry.id, version.version);
  if (revoked !== null) return { reason: 'revoked', detail: revoked.reason };
  if (version.apiVersion !== context.apiVersion) {
    return {
      reason: 'api',
      detail: `requires extension API ${version.apiVersion}`,
    };
  }
  return minAppVersionFailure(version.minAppVersion, context.appVersion);
};

export const resolveVersion = (
  entry: CatalogEntry,
  context: ResolveContext,
): Resolution => {
  const platform = platformFailure(entry.platforms, context.platform);
  const failures = entry.versions.map(
    (version) => platform ?? versionFailure(entry, version, context),
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
