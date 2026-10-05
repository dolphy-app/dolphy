import {
  BUILTIN_THEMES,
  MATERIAL_WIDTH_RANGE,
  MAX_TOURS,
  THEME_ID_PATTERN,
  TOUR_ID_PATTERN,
  type LocaleMode,
  type TourStatus,
  type UiSettingsDto,
} from '@dolphy-app/engine-contract';

export const MAX_THEME_ID_LENGTH = 64;
export const LOCALE_MODES: readonly LocaleMode[] = ['system', 'ru', 'en'];

export const DEFAULT_UI_SETTINGS: Readonly<UiSettingsDto> = Object.freeze({
  theme: 'system',
  locale: 'system',
});

/** Встроенный режим или id темы расширения; существование темы не проверяется. */
export const isThemeId = (value: unknown): value is string =>
  typeof value === 'string' &&
  ((BUILTIN_THEMES as readonly string[]).includes(value) ||
    (value.length <= MAX_THEME_ID_LENGTH && THEME_ID_PATTERN.test(value)));

export const isUnitId = (value: unknown): value is string =>
  typeof value === 'string' && value !== '';

export const isMaterialWidth = (value: unknown): value is number =>
  Number.isInteger(value) &&
  (value as number) >= MATERIAL_WIDTH_RANGE.min &&
  (value as number) <= MATERIAL_WIDTH_RANGE.max;

export const isTourId = (value: unknown): value is string =>
  typeof value === 'string' && TOUR_ID_PATTERN.test(value);

export const isTourStatus = (value: unknown): value is TourStatus =>
  value === 'completed' || value === 'skipped';

export const isLocaleMode = (value: unknown): value is LocaleMode =>
  LOCALE_MODES.includes(value as LocaleMode);

const fieldOf = (raw: unknown, key: keyof UiSettingsDto): unknown =>
  typeof raw === 'object' && raw !== null ? Reflect.get(raw, key) : undefined;

/** Записи о турах: неверные ключи и значения отбрасываются, лишние сверх `MAX_TOURS` тоже. */
const decodeTours = (raw: unknown): Record<string, TourStatus> => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const entries = Object.entries(raw).filter(
    (entry): entry is [string, TourStatus] =>
      isTourId(entry[0]) && isTourStatus(entry[1]),
  );
  return Object.fromEntries(entries.slice(0, MAX_TOURS));
};

/**
 * Сохранённое значение → настройки интерфейса. Хранилище может содержать
 * запись более старой или новой версии: неизвестные поля отбрасываются,
 * неверные и недостающие значения заменяются умолчаниями поодиночке, чтобы
 * запуск не ломался.
 */
export const decodeUiSettings = (raw: unknown): UiSettingsDto => {
  const theme = fieldOf(raw, 'theme');
  const locale = fieldOf(raw, 'locale');
  const activeCourseId = fieldOf(raw, 'activeCourseId');
  const materialWidth = fieldOf(raw, 'materialWidth');
  const materialCollapsed = fieldOf(raw, 'materialCollapsed');
  const tours = decodeTours(fieldOf(raw, 'tours'));
  return {
    theme: isThemeId(theme) ? theme : DEFAULT_UI_SETTINGS.theme,
    locale: isLocaleMode(locale) ? locale : DEFAULT_UI_SETTINGS.locale,
    ...(isUnitId(activeCourseId) && { activeCourseId }),
    ...(isMaterialWidth(materialWidth) && { materialWidth }),
    ...(materialCollapsed === true && { materialCollapsed }),
    ...(Object.keys(tours).length > 0 && { tours }),
  };
};
