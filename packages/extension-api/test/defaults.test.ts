import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAIN,
  DEFAULT_RENDERER,
  ELEMENT_NAME_PATTERN,
  defaultElementName,
} from '../src/index.ts';

describe('defaultElementName', () => {
  it.each([
    ['dolphy.sql', 'dolphy-sql-answer'],
    ['acme', 'acme-answer'],
    ['acme.quiz-pack.choice', 'acme-quiz-pack-choice-answer'],
  ])('%s → %s', (id, expected) => {
    expect(defaultElementName(id)).toBe(expected);
    expect(ELEMENT_NAME_PATTERN.test(expected)).toBe(true);
  });
});

describe('default paths', () => {
  it('match the extension directory convention', () => {
    expect(DEFAULT_MAIN).toBe('./main.mjs');
    expect(DEFAULT_RENDERER).toBe('./view.mjs');
  });
});
