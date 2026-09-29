import type { UserPreferences } from '../domain/manifest.ts';

/**
 * Порядок по кодовым точкам Unicode (совпадает с байтовым порядком UTF-8,
 * как `str::cmp` в Rust); `Array.sort()` сравнивал бы UTF-16 code units.
 */
export const compareCodePoints = (a: string, b: string): number => {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i)!;
    const y = b.codePointAt(j)!;
    if (x !== y) return x < y ? -1 : 1;
    i += x > 0xffff ? 2 : 1;
    j += y > 0xffff ? 2 : 1;
  }
  if (i < a.length) return 1;
  return j < b.length ? -1 : 0;
};

/**
 * Настройки по умолчанию, когда `user_preferences.json` отсутствует.
 * Осознанное отличие от Trane, где `get_user_preferences` без файла — `Err`:
 * файл создаёт только `init_config_directory`, а у движка нет отдельного
 * шага инициализации каталога настроек.
 */
export const createDefaultPreferences = (): UserPreferences => ({
  scheduler: null,
  ignored_paths: [],
  transcription: null,
});
