/**
 * Всё, что связано со смоуком, живёт здесь и достижимо только из кода за
 * флагом сборки `__SPIRULA_SMOKE_BUILD__`: в релизном бандле этих имён нет
 * (`test/release-bundle.test.ts`).
 */

/** Только для смоук-сборки: отчёт о сквозной проверке. */
export interface SmokeBridge {
  report(result: unknown): void;
  killHost(): Promise<boolean>;
}

export const SMOKE_CHANNELS = {
  report: 'smoke:report',
  killHost: 'smoke:killHost',
} as const;

/** Аргумент командной строки renderer: preload по нему включает `smoke`. */
export const SMOKE_ARGUMENT = '--spirula-smoke';
