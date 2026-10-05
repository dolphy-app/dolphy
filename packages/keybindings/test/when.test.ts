import { describe, expect, it } from 'vitest';
import {
  evaluateWhen,
  parseWhen,
  tryParseWhen,
  whenOverlaps,
  WhenSyntaxError,
  whenToText,
} from '../src/index.ts';

const check = (text: string, context: Record<string, unknown>) =>
  evaluateWhen(parseWhen(text), (key) => context[key]);

const overlaps = (left: string | null, right: string | null) =>
  whenOverlaps(
    left === null ? null : parseWhen(left),
    right === null ? null : parseWhen(right),
  );

describe('parseWhen and evaluateWhen', () => {
  it.each([
    ['a', { a: true }, true],
    ['a', {}, false],
    ['a', { a: '' }, false],
    ['!a', {}, true],
    ['!a', { a: 'x' }, false],
    ['a && b', { a: true, b: true }, true],
    ['a && b', { a: true }, false],
    ['a || b', { b: 1 }, true],
    ['a || b && c', { a: true }, true],
    ['(a || b) && c', { a: true }, false],
    ['!(a || b)', {}, true],
    ['!(a || b)', { b: true }, false],
    ["page == 'courses'", { page: 'courses' }, true],
    ['page == courses', { page: 'courses' }, true],
    ['page == courses', {}, false],
    ['page != courses', {}, true],
    ['page != courses', { page: 'graph' }, true],
    ['page != courses', { page: 'courses' }, false],
    ["title == 'two words'", { title: 'two words' }, true],
    ['n == 2', { n: 2 }, true],
    ['flag == false', { flag: false }, true],
    ['  a   &&   !b  ', { a: true }, true],
  ])('%s in %j → %s', (text, context, expected) => {
    expect(check(text, context)).toBe(expected);
  });

  it('treats a missing condition as always true', () => {
    expect(evaluateWhen(null, () => undefined)).toBe(true);
  });

  it.each([
    ['', 'empty', 0],
    ['   ', 'empty', 0],
    ['a &&', 'unexpected-end', 4],
    ['&& a', 'unexpected-token', 0],
    ['a b', 'unexpected-token', 2],
    ['(a', 'unexpected-end', 2],
    ['a)', 'unexpected-token', 1],
    ['!', 'unexpected-end', 1],
    ['!a == b', 'unexpected-token', 3],
    ['a ==', 'unexpected-end', 4],
    ["a == 'x", 'unterminated-string', 5],
    ['a = b', 'unexpected-token', 2],
    ['1a', 'unexpected-token', 0],
    [`${'('.repeat(20)}a${')'.repeat(20)}`, 'too-deep', 17],
    ['a'.repeat(300), 'too-long', 0],
  ])('rejects "%s" as %s at %i', (text, reason, position) => {
    try {
      parseWhen(text);
      expect.unreachable('must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(WhenSyntaxError);
      expect((error as WhenSyntaxError).reason).toBe(reason);
      expect((error as WhenSyntaxError).position).toBe(position);
    }
  });

  it('tryParseWhen returns null on errors', () => {
    expect(tryParseWhen('a &&')).toBeNull();
    expect(tryParseWhen('a')).not.toBeNull();
  });

  it('writes a canonical text that parses to an equivalent expression', () => {
    for (const text of [
      'a',
      '!a && b',
      '(a || b) && c',
      '!(a && b) || c',
      "page == 'courses' && !modalOpen",
      "title != 'two words'",
    ]) {
      const expr = parseWhen(text);
      expect(parseWhen(whenToText(expr))).toEqual(expr);
    }
    expect(whenToText(parseWhen('(a && b) && (c)'))).toBe('a && b && c');
    expect(whenToText(parseWhen('a || (b && c)'))).toBe('a || b && c');
  });
});

describe('whenOverlaps', () => {
  it.each([
    [null, null, true],
    [null, 'a', true],
    ['a', 'a', true],
    ['a', 'b', true],
    ['a', '!a', false],
    ['inputFocus', '!inputFocus', false],
    ['a && b', '!a', false],
    ['a && b', '!c', true],
    ['a || b', '!a && !b', false],
    ['a || b', '!a', true],
    ["page == 'courses'", "page == 'graph'", false],
    ["page == 'courses'", "page == 'courses'", true],
    ["page == 'courses'", "page != 'courses'", false],
    ["page == 'courses'", "page != 'graph'", true],
    ["page == 'courses'", '!page', false],
    ["page == 'courses'", 'page', true],
    ["page == 'courses' || page == 'graph'", "page == 'settings'", false],
    [
      "page == 'courses' || page == 'graph'",
      "page == 'graph' && !modalOpen",
      true,
    ],
    ['(a || b) && (c || d)', '!a && !b', false],
    ['a && !a', 'b', false],
    ['flag == false', '!flag', true],
    ['flag == false', 'flag', true],
    ["page == ''", 'page', false],
    ['!(a && b)', 'a && b', false],
    ['!(a || b)', 'a', false],
  ])('%s vs %s → %s', (left, right, expected) => {
    expect(overlaps(left, right)).toBe(expected);
    expect(overlaps(right, left)).toBe(expected);
  });

  it('reports overlap when the expression grows past the term limit', () => {
    const clause = (i: number) => `(a${i} || b${i})`;
    const big = Array.from({ length: 8 }, (_, i) => clause(i)).join(' && ');
    expect(overlaps(big, '!a0 && !b0')).toBe(true);
  });
});
