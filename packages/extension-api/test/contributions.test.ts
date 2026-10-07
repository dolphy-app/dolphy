import { describe, expect, it } from 'vitest';
import {
  BUILTIN_THEME_IDS,
  EMPTY_SERVER_REGISTRATION,
  MARKDOWN_LANGUAGE_PATTERN,
  THEME_COLOR_KEYS,
  THEME_VARIABLE_KEYS,
} from '../src/index.ts';

describe('registration constants', () => {
  it('color and variable keys are unique and do not overlap', () => {
    const all = [...THEME_COLOR_KEYS, ...THEME_VARIABLE_KEYS];
    expect(new Set(all).size).toBe(all.length);
  });

  it('built-in themes are reserved', () => {
    expect(BUILTIN_THEME_IDS).toEqual(['system', 'light', 'dark']);
  });

  it.each(['a', 'mermaid', 'chem-3d', 'a'.repeat(32)])(
    'accepts markdown language %s',
    (language) => {
      expect(MARKDOWN_LANGUAGE_PATTERN.test(language)).toBe(true);
    },
  );

  it.each(['', '1a', 'A', 'a_b', 'a b', 'a'.repeat(33)])(
    'rejects markdown language %j',
    (language) => {
      expect(MARKDOWN_LANGUAGE_PATTERN.test(language)).toBe(false);
    },
  );

  it('the empty registration holds nothing and cannot be changed', () => {
    for (const list of Object.values(EMPTY_SERVER_REGISTRATION)) {
      expect(list).toEqual([]);
      expect(Object.isFrozen(list)).toBe(true);
    }
    expect(Object.isFrozen(EMPTY_SERVER_REGISTRATION)).toBe(true);
  });
});
