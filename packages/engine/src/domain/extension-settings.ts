import {
  EXTENSION_ID_PATTERN,
  type ExtensionSettingsDto,
} from '@dolphy-app/engine-contract';

export const MAX_EXTENSION_ID_LENGTH = 64;

export const DEFAULT_EXTENSION_SETTINGS: Readonly<ExtensionSettingsDto> =
  Object.freeze({
    disabled: [],
    checkUpdates: true,
    safeMode: false,
    notificationsOff: [],
    catalogUrl: null,
    schedulesOff: [],
  });

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
  checkUpdates: settings.checkUpdates,
  safeMode: settings.safeMode,
  notificationsOff: normalizeIds(settings.notificationsOff),
  catalogUrl: settings.catalogUrl,
  schedulesOff: normalizeIds(settings.schedulesOff),
});

/** Только явное `false` выключает проверку: всё остальное — умолчание. */
const decodeCheckUpdates = (raw: unknown): boolean => raw !== false;

/** Адрес каталога: нечитаемое значение (не строка, не `http(s)`-URL) — «не задан». */
const decodeCatalogUrl = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  try {
    const { protocol } = new URL(raw);
    return protocol === 'https:' || protocol === 'http:' ? raw : null;
  } catch {
    return null;
  }
};

/** Только явное `true` включает безопасный режим: всё остальное — умолчание. */
const decodeSafeMode = (raw: unknown): boolean => raw === true;

const decodeIds = (raw: unknown): string[] | null =>
  Array.isArray(raw) && raw.every(isExtensionId) ? normalizeIds(raw) : null;

/** Список, которого могло не быть (запись до его появления): нет значения — пусто, неверная форма — `null`. */
const decodeOptionalIds = (raw: unknown): string[] | null =>
  raw === undefined ? [] : decodeIds(raw);

/**
 * Сохранённое значение → настройки расширений: неверная форма целиком
 * заменяется пустыми списками, чтобы запуск не ломался.
 */
export const decodeExtensionSettings = (raw: unknown): ExtensionSettingsDto => {
  if (typeof raw !== 'object' || raw === null) {
    return normalizeExtensionSettings(DEFAULT_EXTENSION_SETTINGS);
  }
  const disabled = decodeIds(Reflect.get(raw, 'disabled'));
  const checkUpdates = decodeCheckUpdates(Reflect.get(raw, 'checkUpdates'));
  const safeMode = decodeSafeMode(Reflect.get(raw, 'safeMode'));
  const notificationsOff = decodeOptionalIds(
    Reflect.get(raw, 'notificationsOff'),
  );
  const catalogUrl = decodeCatalogUrl(Reflect.get(raw, 'catalogUrl'));
  const schedulesOff = decodeOptionalIds(Reflect.get(raw, 'schedulesOff'));
  if (disabled === null || notificationsOff === null || schedulesOff === null) {
    return normalizeExtensionSettings({
      ...DEFAULT_EXTENSION_SETTINGS,
      checkUpdates,
      safeMode,
      catalogUrl,
    });
  }
  return {
    disabled,
    checkUpdates,
    safeMode,
    notificationsOff,
    catalogUrl,
    schedulesOff,
  };
};

/** Метка последней проверки обновлений (epoch ms): неверное значение — «не проверяли». */
export const decodeUpdateCheckedAt = (raw: unknown): number | null =>
  typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null;
