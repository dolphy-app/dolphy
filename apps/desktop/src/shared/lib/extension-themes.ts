import type { ThemeContributionDto } from '@spirula/engine-contract';
import type { ThemeDefinition } from 'vuetify';
import { DARK_THEME, LIGHT_THEME } from './builtin-themes.ts';

const BUILTIN = ['system', 'light', 'dark'];

/**
 * Имя темы в Vuetify (из него растёт класс `.v-theme--<имя>`). Id расширений
 * не содержат `_`, поэтому отображение взаимно однозначно.
 */
export const vuetifyThemeName = (id: string): string =>
  `ext__${id.replaceAll('.', '__')}`;

/** Встроенная тема, на которую опирается тема расширения. */
export const baseThemeOf = (
  contribution: Pick<ThemeContributionDto, 'dark'>,
): ThemeDefinition => (contribution.dark ? DARK_THEME : LIGHT_THEME);

/** Цвета и переменные расширения поверх базовой темы. */
export const toVuetifyTheme = (
  contribution: Pick<ThemeContributionDto, 'dark' | 'colors' | 'variables'>,
  base: ThemeDefinition,
): ThemeDefinition => ({
  dark: contribution.dark,
  colors: { ...base.colors, ...contribution.colors },
  variables: { ...base.variables, ...contribution.variables },
});

/** Сохранённый id → имя темы Vuetify; неизвестная тема — системная. */
export const resolveThemeName = (
  saved: string,
  themes: readonly Pick<ThemeContributionDto, 'id'>[],
): string => {
  if (BUILTIN.includes(saved)) return saved;
  return themes.some(({ id }) => id === saved)
    ? vuetifyThemeName(saved)
    : 'system';
};

/** Id, который показывает выбор: неизвестный сохранённый id — `system`. */
export const effectiveThemeId = (
  saved: string,
  themes: readonly Pick<ThemeContributionDto, 'id'>[],
): string => (resolveThemeName(saved, themes) === 'system' ? 'system' : saved);
