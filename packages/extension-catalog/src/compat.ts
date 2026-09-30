import { compareSemver } from './semver.ts';

export type CompatibilityReason = 'platform' | 'app';

export interface CompatibilityFailure {
  reason: CompatibilityReason;
  /** Причина по-английски: для логов, диагностики и `dolphy-ext`; интерфейс строит текст из `reason` и данных. */
  detail: string;
}

/** Где выполняется проверка; то же правило применяют приложение, установщик и сборщик каталога. */
export interface CompatibilityContext {
  /** `undefined` — версия приложения неизвестна, `minAppVersion` не проверяется. */
  appVersion: string | undefined;
  platform: string;
}

/** Пустой список платформ — любая. */
export const platformFailure = (
  platforms: readonly string[],
  platform: string,
): CompatibilityFailure | null =>
  platforms.length === 0 || platforms.some((p) => p === platform)
    ? null
    : { reason: 'platform', detail: `not available on ${platform}` };

export const minAppVersionFailure = (
  minAppVersion: string | null,
  appVersion: string | undefined,
): CompatibilityFailure | null =>
  minAppVersion !== null &&
  appVersion !== undefined &&
  compareSemver(minAppVersion, appVersion) > 0
    ? { reason: 'app', detail: `requires app >= ${minAppVersion}` }
    : null;

/** `minAppVersion` и `platforms` манифеста или записи каталога. */
export const checkCompatibility = (
  requirements: { minAppVersion: string | null; platforms: readonly string[] },
  context: CompatibilityContext,
): CompatibilityFailure | null =>
  minAppVersionFailure(requirements.minAppVersion, context.appVersion) ??
  platformFailure(requirements.platforms, context.platform);
