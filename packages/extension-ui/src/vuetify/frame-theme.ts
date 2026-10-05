/**
 * The Vuetify theme of the frame. The app sends its theme to every frame as CSS
 * variables on `<html>` (`--v-theme-*`, `--v-border-*`, … see the `theme` message of
 * the frame protocol). Vuetify builds its own variables, `bg-*` / `text-*` classes and
 * overlay multipliers from a theme object, so the theme is rebuilt from these variables:
 * the values it generates equal the app's, and a change of the app theme reaches
 * the components through the same path.
 */
import type { ThemeDefinition } from 'vuetify';

/** The colour keys of the app theme (`THEME_COLOR_KEYS` of the extension contract, without `hero-*`). */
const COLOR_KEYS = [
  'background',
  'surface',
  'surface-bright',
  'surface-light',
  'surface-variant',
  'on-background',
  'on-surface',
  'on-surface-variant',
  'primary',
  'on-primary',
  'secondary',
  'on-secondary',
  'error',
  'on-error',
  'warning',
  'on-warning',
  'success',
  'on-success',
  'info',
  'on-info',
] as const;

/** Variables of the Vuetify theme (without the `--v-` prefix) that the frame passes as they are. */
const VARIABLE_KEYS = [
  'border-color',
  'border-opacity',
  'high-emphasis-opacity',
  'medium-emphasis-opacity',
  'disabled-opacity',
  'idle-opacity',
  'hover-opacity',
  'focus-opacity',
  'selected-opacity',
  'activated-opacity',
  'pressed-opacity',
  'dragged-opacity',
  'theme-kbd',
  'theme-on-kbd',
  'theme-code',
  'theme-on-code',
] as const;

export const FRAME_THEME_NAME = 'dolphy';

const TRIPLET = /^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,[^,]*)?$/;

/** `25, 118, 210` (the Vuetify variable form) to `#1976d2`; anything else is not a colour of the frame. */
const toHex = (triplet: string): string | null => {
  const match = TRIPLET.exec(triplet);
  if (match === null) return null;
  let hex = '#';
  for (const part of match.slice(1, 4)) {
    const channel = Number(part);
    if (channel > 255) return null;
    hex += channel.toString(16).padStart(2, '0');
  }
  return hex;
};

export const readFrameTheme = (doc: Document): ThemeDefinition => {
  const view = doc.defaultView;
  const root = doc.documentElement;
  if (view === null) return { dark: false };
  const style = view.getComputedStyle(root);
  const colors: Record<string, string> = {};
  for (const key of COLOR_KEYS) {
    const hex = toHex(style.getPropertyValue(`--v-theme-${key}`));
    if (hex !== null) colors[key] = hex;
  }
  const variables: Record<string, string> = {};
  for (const key of VARIABLE_KEYS) {
    const value = style.getPropertyValue(`--v-${key}`).trim();
    if (value !== '') variables[key] = value;
  }
  return {
    dark: style.colorScheme === 'dark',
    colors,
    variables,
  };
};

/** `<html lang>` of the frame (the app sends its interface language): `ru` or `en`. */
export const readFrameLocale = (doc: Document): 'ru' | 'en' =>
  doc.documentElement.lang.toLowerCase().startsWith('ru') ? 'ru' : 'en';
