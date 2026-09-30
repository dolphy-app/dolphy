import {
  EXTENSION_ID_PATTERN,
  type ExtensionSettingsDto,
} from '@spirula/engine-contract';

export const MAX_EXTENSION_ID_LENGTH = 64;

export const DEFAULT_EXTENSION_SETTINGS: Readonly<ExtensionSettingsDto> =
  Object.freeze({ disabled: [], trusted: [] });

export const isExtensionId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= MAX_EXTENSION_ID_LENGTH &&
  EXTENSION_ID_PATTERN.test(value);

/** Отсортированный список без повторов. */
const compareIds = (a: string, b: string): number => {
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

const normalizeIds = (ids: readonly string[]): string[] =>
  [...new Set(ids)].sort(compareIds);

/** Приводит настройки к каноническому виду: отсортировано, без повторов. */
export const normalizeExtensionSettings = (
  settings: ExtensionSettingsDto,
): ExtensionSettingsDto => ({
  disabled: normalizeIds(settings.disabled),
  trusted: normalizeIds(settings.trusted),
});

const decodeIds = (raw: unknown): string[] | null =>
  Array.isArray(raw) && raw.every(isExtensionId) ? normalizeIds(raw) : null;

/**
 * Сохранённое значение → настройки расширений: неверная форма целиком
 * заменяется пустыми списками, чтобы запуск не ломался.
 */
export const decodeExtensionSettings = (raw: unknown): ExtensionSettingsDto => {
  if (typeof raw !== 'object' || raw === null) {
    return normalizeExtensionSettings(DEFAULT_EXTENSION_SETTINGS);
  }
  const disabled = decodeIds(Reflect.get(raw, 'disabled'));
  const trusted = decodeIds(Reflect.get(raw, 'trusted'));
  if (disabled === null || trusted === null) {
    return normalizeExtensionSettings(DEFAULT_EXTENSION_SETTINGS);
  }
  return { disabled, trusted };
};
