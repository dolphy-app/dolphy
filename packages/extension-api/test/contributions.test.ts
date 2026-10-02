import { describe, expect, it } from 'vitest';
import {
  BUILTIN_THEME_IDS,
  DEFAULT_MARKDOWN_RENDERER,
  THEME_COLOR_KEYS,
  THEME_VARIABLE_KEYS,
} from '../src/index.ts';

describe('contribution points: constants', () => {
  it('color and variable keys are unique and do not overlap', () => {
    const all = [...THEME_COLOR_KEYS, ...THEME_VARIABLE_KEYS];
    expect(new Set(all).size).toBe(all.length);
  });

  it('built-in themes are reserved', () => {
    expect(BUILTIN_THEME_IDS).toEqual(['system', 'light', 'dark']);
  });

  it('the default renderer is markdown.mjs', () => {
    expect(DEFAULT_MARKDOWN_RENDERER).toBe('./markdown.mjs');
  });
});
