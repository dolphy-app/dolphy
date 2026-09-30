import type {
  LocaleMode,
  ThemeMode,
  UiSettingsDto,
} from '@lms/engine-contract';

export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];
export const LOCALE_MODES: readonly LocaleMode[] = ['system', 'ru', 'en'];

export const DEFAULT_UI_SETTINGS: Readonly<UiSettingsDto> = Object.freeze({
  theme: 'system',
  locale: 'system',
});

export const isThemeMode = (value: unknown): value is ThemeMode =>
  THEME_MODES.includes(value as ThemeMode);

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
  return {
    theme: isThemeMode(theme) ? theme : DEFAULT_UI_SETTINGS.theme,
    locale: isLocaleMode(locale) ? locale : DEFAULT_UI_SETTINGS.locale,
  };
};
