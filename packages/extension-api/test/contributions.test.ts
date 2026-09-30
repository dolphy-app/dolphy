import { describe, expect, it } from 'vitest';
import {
  BUILTIN_THEME_IDS,
  DEFAULT_MARKDOWN_RENDERER,
  THEME_COLOR_KEYS,
  THEME_VARIABLE_KEYS,
} from '../src/index.ts';

describe('точки вклада: константы', () => {
  it('ключи цветов и переменных уникальны и не пересекаются', () => {
    const all = [...THEME_COLOR_KEYS, ...THEME_VARIABLE_KEYS];
    expect(new Set(all).size).toBe(all.length);
  });

  it('встроенные темы зарезервированы', () => {
    expect(BUILTIN_THEME_IDS).toEqual(['system', 'light', 'dark']);
  });

  it('рендерер по умолчанию — markdown.mjs', () => {
    expect(DEFAULT_MARKDOWN_RENDERER).toBe('./markdown.mjs');
  });
});
