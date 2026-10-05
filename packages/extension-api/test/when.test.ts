import { describe, expect, it } from 'vitest';
import {
  WHEN_KEYS,
  WHEN_MAX_LENGTH,
  WhenError,
  evaluateWhen,
  parseWhen,
} from '../src/index.ts';
import type { WhenContext, WhenReason } from '../src/index.ts';

const context = (overrides: Partial<WhenContext> = {}): WhenContext => ({
  route: 'courses',
  'course.active': true,
  'session.active': false,
  locale: 'ru',
  'theme.dark': false,
  ...overrides,
});

const evaluate = (text: string, overrides?: Partial<WhenContext>) =>
  evaluateWhen(parseWhen(text), context(overrides));

describe('evaluateWhen', () => {
  const table: [string, Partial<WhenContext>, boolean][] = [
    ["route == 'courses'", {}, true],
    ["route == 'courses'", { route: 'daily-plan' }, false],
    ["route != 'courses'", { route: 'daily-plan' }, true],
    ["route != 'courses'", {}, false],
    ["route in ('courses', 'daily-plan')", { route: 'daily-plan' }, true],
    ["route in ('courses', 'daily-plan')", { route: 'session' }, false],
    ["route in ('courses')", {}, true],
    ["locale == 'ru'", {}, true],
    ["locale == 'ru'", { locale: 'en' }, false],
    ['course.active', {}, true],
    ['course.active', { 'course.active': false }, false],
    ['!course.active', { 'course.active': false }, true],
    ['!!course.active', {}, true],
    ['session.active', {}, false],
    ['theme.dark == true', { 'theme.dark': true }, true],
    ['theme.dark == false', {}, true],
    ['theme.dark != true', {}, true],
    ['theme.dark in (true)', { 'theme.dark': true }, true],
    ['true', {}, true],
    ['false', {}, false],
    ["course.active && route == 'courses'", {}, true],
    ["course.active && route == 'courses'", { route: 'session' }, false],
    ["session.active || route == 'courses'", {}, true],
    ["session.active || route == 'session'", {}, false],
    // && binds tighter than ||
    ["theme.dark || course.active && route == 'session'", {}, false],
    [
      "(theme.dark || course.active) && route == 'courses'",
      { 'course.active': true },
      true,
    ],
    ["!(route == 'courses')", {}, false],
    [
      "!(route == 'courses' || session.active)",
      { route: 'session', 'session.active': true },
      false,
    ],
    ["!(route == 'courses' || session.active)", { route: 'placement' }, true],
    ["  route\t==\n'courses'  ", {}, true],
    ["route=='courses'&&!session.active||theme.dark", {}, true],
  ];

  it.each(table)('%s with %j is %s', (text, overrides, expected) => {
    expect(evaluate(text, overrides)).toBe(expected);
  });

  it('treats no condition as true', () => {
    expect(evaluateWhen(null, context())).toBe(true);
  });

  it('compares an unknown route name as different from any listed one', () => {
    expect(evaluate("route == 'courses'", { route: '' })).toBe(false);
    expect(evaluate("route != 'courses'", { route: '' })).toBe(true);
  });

  it('reads only the keys the condition needs', () => {
    const read: string[] = [];
    const lazy = {
      get route() {
        read.push('route');
        return 'courses';
      },
      get 'theme.dark'() {
        read.push('theme.dark');
        return true;
      },
      get 'course.active'() {
        read.push('course.active');
        return true;
      },
      get 'session.active'() {
        read.push('session.active');
        return false;
      },
      get locale() {
        read.push('locale');
        return 'ru';
      },
    } satisfies WhenContext;
    expect(
      evaluateWhen(parseWhen("route == 'courses' || theme.dark"), lazy),
    ).toBe(true);
    expect(read).toEqual(['route']);
  });
});

describe('parseWhen: errors', () => {
  const table: [string, string, WhenReason, number][] = [
    ['empty', '', 'empty', 0],
    ['blank', '   ', 'empty', 0],
    ['unknown key', "foo == 'x'", 'unknown-key', 0],
    ['unknown key after &&', 'course.active && nope', 'unknown-key', 17],
    ['key of another registry', 'inputFocus', 'unknown-key', 0],
    ['unknown route value', "route == 'home'", 'unknown-value', 9],
    ['unknown locale value', "locale in ('ru', 'de')", 'unknown-value', 17],
    ['string against a boolean', "theme.dark == 'true'", 'type-mismatch', 14],
    ['boolean against a text key', 'route == true', 'type-mismatch', 9],
    ['text key alone', 'route', 'type-mismatch', 0],
    [
      'text key alone in a group',
      '(locale) && course.active',
      'type-mismatch',
      1,
    ],
    ['number', 'route == 1', 'unexpected-character', 9],
    ['missing right side', 'route ==', 'unexpected-end', 8],
    ['missing literal', 'route == && course.active', 'unexpected-token', 9],
    ['dangling &&', 'course.active &&', 'unexpected-end', 16],
    ['dangling ||', '|| course.active', 'unexpected-token', 0],
    ['single &', 'course.active & session.active', 'unexpected-character', 14],
    ['single =', "route = 'courses'", 'unexpected-character', 6],
    ['unterminated string', "route == 'courses", 'unterminated-string', 9],
    ['unclosed group', '(course.active', 'unexpected-end', 14],
    ['stray close', 'course.active)', 'unexpected-token', 13],
    ['two keys', 'course.active session.active', 'unexpected-token', 14],
    ['in without a list', "route in 'courses'", 'unexpected-token', 9],
    ['empty list', 'route in ()', 'unexpected-token', 10],
    [
      'trailing comma in a list',
      "route in ('courses',)",
      'unexpected-token',
      20,
    ],
    ['unclosed list', "route in ('courses'", 'unexpected-end', 19],
    ['! before a comparison', "!route == 'courses'", 'unexpected-token', 1],
    ['! before nothing', '!', 'unexpected-end', 1],
    [
      'chained comparison',
      "route == 'courses' == 'courses'",
      'unexpected-token',
      19,
    ],
    ['keyword as a key', 'in', 'unknown-key', 0],
  ];

  it.each(table)('%s', (_name, text, reason, position) => {
    expect.assertions(3);
    try {
      parseWhen(text);
    } catch (error) {
      expect(error).toBeInstanceOf(WhenError);
      expect((error as WhenError).reason).toBe(reason);
      expect((error as WhenError).position).toBe(position);
    }
  });

  it('puts the position and the cause into the message', () => {
    expect(() => parseWhen("route == 'home'")).toThrowError(
      /unknown value 'home' for 'route' \(known: .*courses.*\) at 9/,
    );
    expect(() => parseWhen('inputFocus')).toThrowError(
      /unknown key 'inputFocus' \(known: route, course\.active.*\) at 0/,
    );
  });
});

describe('parseWhen: length', () => {
  it('accepts a condition of exactly the limit', () => {
    const text = `course.active${' || course.active'.repeat(11)}`.padEnd(
      WHEN_MAX_LENGTH,
      ' ',
    );
    expect(text).toHaveLength(WHEN_MAX_LENGTH);
    expect(evaluate(text)).toBe(true);
  });

  it('rejects one character more', () => {
    const text = `course.active${' '.repeat(WHEN_MAX_LENGTH)}`;
    expect(text).toHaveLength(WHEN_MAX_LENGTH + 13);
    expect(() => parseWhen(text)).toThrowError(WhenError);
    expect(() => parseWhen('x'.repeat(WHEN_MAX_LENGTH + 1))).toThrowError(
      /longer than 200/,
    );
  });
});

describe('WHEN_KEYS', () => {
  it('lists exactly the keys of the context', () => {
    expect(Object.keys(WHEN_KEYS).sort()).toEqual(
      Object.keys(context()).sort(),
    );
  });
});
