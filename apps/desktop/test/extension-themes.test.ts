import { describe, expect, it } from 'vitest';
import { DARK_THEME, LIGHT_THEME } from '@/shared/lib/builtin-themes.ts';
import {
  baseThemeOf,
  effectiveThemeId,
  resolveThemeName,
  toVuetifyTheme,
  vuetifyThemeName,
} from '@/shared/lib/extension-themes.ts';

const themes = [{ id: 'acme.midnight' }, { id: 'acme-midnight' }];

describe('vuetifyThemeName', () => {
  it('is injective and a valid class fragment', () => {
    const ids = ['a.b', 'a-b', 'ab', 'a.b.c', 'a-b.c', 'a.b-c'];
    const names = ids.map(vuetifyThemeName);
    expect(new Set(names).size).toBe(ids.length);
    for (const name of names) expect(name).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('toVuetifyTheme', () => {
  it('layers the contribution over the base by its dark flag', () => {
    const theme = toVuetifyTheme(
      {
        dark: true,
        colors: { background: '#101820' },
        variables: { 'border-opacity': 0.5 },
      },
      baseThemeOf({ dark: true }),
    );
    expect(theme.dark).toBe(true);
    expect(theme.colors?.['background']).toBe('#101820');
    expect(theme.colors?.['surface']).toBe(DARK_THEME.colors?.['surface']);
    expect(theme.variables?.['border-opacity']).toBe(0.5);
    expect(theme.variables?.['border-color']).toBe(
      DARK_THEME.variables?.['border-color'],
    );
    expect(baseThemeOf({ dark: false })).toBe(LIGHT_THEME);
  });
});

describe('resolveThemeName', () => {
  it('keeps builtin modes, maps known ids, falls back to system', () => {
    expect(resolveThemeName('dark', themes)).toBe('dark');
    expect(resolveThemeName('system', [])).toBe('system');
    expect(resolveThemeName('acme.midnight', themes)).toBe(
      'ext__acme__midnight',
    );
    expect(resolveThemeName('gone.theme', themes)).toBe('system');
    expect(effectiveThemeId('gone.theme', themes)).toBe('system');
    expect(effectiveThemeId('acme.midnight', themes)).toBe('acme.midnight');
  });
});
