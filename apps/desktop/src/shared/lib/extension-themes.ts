import type { ThemeDefinition } from 'vuetify';
import { DARK_THEME, LIGHT_THEME } from './builtin-themes.ts';
import type { ClientTheme } from './extension-client-registrations.ts';

const BUILTIN = ['system', 'light', 'dark'];

/**
 * Имя темы в Vuetify (из него растёт класс `.v-theme--<имя>`). Id расширений
 * не содержат `_`, поэтому отображение взаимно однозначно.
 */
export const vuetifyThemeName = (id: string): string =>
  `ext__${id.replaceAll('.', '__')}`;

/** Встроенная тема, на которую опирается тема расширения. */
export const baseThemeOf = (
  theme: Pick<ClientTheme, 'dark'>,
): ThemeDefinition => (theme.dark ? DARK_THEME : LIGHT_THEME);

/** Цвета и переменные расширения поверх базовой темы. */
export const toVuetifyTheme = (
  theme: Pick<ClientTheme, 'dark' | 'colors' | 'variables'>,
  base: ThemeDefinition,
): ThemeDefinition => ({
  dark: theme.dark,
  colors: { ...base.colors, ...theme.colors },
  variables: { ...base.variables, ...theme.variables },
});

/** Сохранённый id → имя темы Vuetify; неизвестная (ещё не загруженная или удалённая) — системная. */
export const resolveThemeName = (
  saved: string,
  themes: readonly Pick<ClientTheme, 'id'>[],
): string => {
  if (BUILTIN.includes(saved)) return saved;
  return themes.some(({ id }) => id === saved)
    ? vuetifyThemeName(saved)
    : 'system';
};

/** Id, который показывает выбор: неизвестный сохранённый id — `system`. */
export const effectiveThemeId = (
  saved: string,
  themes: readonly Pick<ClientTheme, 'id'>[],
): string => (resolveThemeName(saved, themes) === 'system' ? 'system' : saved);
