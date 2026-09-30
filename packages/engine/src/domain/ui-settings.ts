import {
  BUILTIN_THEMES,
  THEME_ID_PATTERN,
  type LocaleMode,
  type UiSettingsDto,
} from '@lms/engine-contract';

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

export const isLocaleMode = (value: unknown): value is LocaleMode =>
  LOCALE_MODES.includes(value as LocaleMode);

const fieldOf = (raw: unknown, key: keyof UiSettingsDto): unknown =>
  typeof raw === 'object' && raw !== null ? Reflect.get(raw, key) : undefined;

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
  return {
    theme: isThemeId(theme) ? theme : DEFAULT_UI_SETTINGS.theme,
    locale: isLocaleMode(locale) ? locale : DEFAULT_UI_SETTINGS.locale,
    ...(isUnitId(activeCourseId) && { activeCourseId }),
  };
};
