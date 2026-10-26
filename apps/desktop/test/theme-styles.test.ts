// @vitest-environment happy-dom
import { shallowRef } from 'vue';
import { describe, expect, it } from 'vitest';
import type { ClientTheme } from '@/shared/lib/extension-clients.ts';
import {
  THEME_STYLE_ATTRIBUTE,
  bindThemeStyles,
  themeStyleText,
} from '@/shared/lib/theme-styles.ts';

const theme = (
  id: string,
  shape: Pick<ClientTheme, 'tokens' | 'css'>,
): ClientTheme => ({
  kind: 'theme',
  key: `${id}:1:1`,
  id,
  extensionId: id,
  label: id,
  dark: false,
  colors: { primary: '#123456' },
  variables: {},
  ...shape,
});

const styleOf = () =>
  document.head.querySelector(`style[${THEME_STYLE_ATTRIBUTE}]`);

describe('themeStyleText', () => {
  it('writes tokens as root variables and the font for Vuetify too, then the css as is', () => {
    const text = themeStyleText({
      tokens: { 'radius-lg': '0.5rem', 'font-family': "Inter, 'Segoe UI'" },
      css: '@font-face{font-family:Inter}.v-btn{height:36px}',
    });
    expect(text).toBe(
      ":root{--dolphy-radius-lg:0.5rem;--dolphy-font-family:Inter, 'Segoe UI';--v-font-body:Inter, 'Segoe UI';}" +
        '@font-face{font-family:Inter}.v-btn{height:36px}',
    );
  });

  it('has no :root rule without tokens', () => {
    expect(themeStyleText({ tokens: {}, css: '.a{color:red}' })).toBe(
      '.a{color:red}',
    );
  });
});

describe('bindThemeStyles', () => {
  it('applies the selected theme at once and keeps one element', () => {
    const saved = shallowRef('acme.a');
    const themes = shallowRef([
      theme('acme.a', { tokens: { 'radius-md': '2px' }, css: '.a{}' }),
      theme('acme.b', { tokens: { 'radius-md': '9px' }, css: '.b{}' }),
    ]);
    const stop = bindThemeStyles(saved, () => themes.value);
    expect(styleOf()?.textContent).toBe(':root{--dolphy-radius-md:2px;}.a{}');
    saved.value = 'acme.b';
    expect(
      document.head.querySelectorAll(`style[${THEME_STYLE_ATTRIBUTE}]`),
    ).toHaveLength(1);
    expect(styleOf()?.textContent).toBe(':root{--dolphy-radius-md:9px;}.b{}');
    stop();
  });

  it('removes the styles for a built-in theme, a theme that disappeared and one without styles', () => {
    const saved = shallowRef('acme.a');
    const themes = shallowRef([
      theme('acme.a', { tokens: {}, css: '.a{}' }),
      theme('acme.plain', { tokens: {}, css: '' }),
    ]);
    const stop = bindThemeStyles(saved, () => themes.value);
    expect(styleOf()).not.toBeNull();

    saved.value = 'dark';
    expect(styleOf()).toBeNull();

    saved.value = 'acme.a';
    expect(styleOf()).not.toBeNull();
    themes.value = [];
    expect(styleOf()).toBeNull();
    // сохранённый id остался: тема вернулась — стили вернулись
    themes.value = [theme('acme.a', { tokens: {}, css: '.back{}' })];
    expect(styleOf()?.textContent).toBe('.back{}');

    saved.value = 'acme.plain';
    themes.value = [theme('acme.plain', { tokens: {}, css: '' })];
    expect(styleOf()).toBeNull();
    stop();
  });

  it('stop leaves no element behind', () => {
    const saved = shallowRef('acme.a');
    const stop = bindThemeStyles(saved, () => [
      theme('acme.a', { tokens: {}, css: '.a{}' }),
    ]);
    expect(styleOf()).not.toBeNull();
    stop();
    expect(styleOf()).toBeNull();
  });
});
