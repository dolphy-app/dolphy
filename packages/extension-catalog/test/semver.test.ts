import { describe, expect, it } from 'vitest';
import {
  CatalogFormatError,
  compareSemver,
  isSemver,
  parseSemver,
  satisfiesRange,
} from '../src/index.ts';

describe('parseSemver', () => {
  it('разбирает релиз и пререлиз', () => {
    expect(parseSemver('1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
    });
    expect(parseSemver('1.0.0-alpha.1')?.prerelease).toEqual(['alpha', '1']);
  });

  it.each([
    '',
    '1',
    '1.2',
    '1.2.3.4',
    '01.2.3',
    '1.02.3',
    '1.2.3+build',
    '1.2.3-',
    '1.2.3-a..b',
    '1.2.3-01',
    'v1.2.3',
    '1.2.3-a_b',
    ' 1.2.3',
  ])('отклоняет %j', (text) => {
    expect(parseSemver(text)).toBeNull();
    expect(isSemver(text)).toBe(false);
  });
});

describe('compareSemver', () => {
  it.each([
    ['1.0.0', '2.0.0', -1],
    ['1.2.0', '1.10.0', -1],
    ['1.0.10', '1.0.9', 1],
    ['1.0.0', '1.0.0', 0],
    ['1.0.0-alpha', '1.0.0', -1],
    ['1.0.0', '1.0.0-rc.1', 1],
    ['1.0.0-alpha', '1.0.0-alpha.1', -1],
    ['1.0.0-alpha.1', '1.0.0-alpha.beta', -1],
    ['1.0.0-alpha.beta', '1.0.0-beta', -1],
    ['1.0.0-beta.2', '1.0.0-beta.11', -1],
    ['1.0.0-beta.11', '1.0.0-rc.1', -1],
    ['1.0.0-1', '1.0.0-alpha', -1],
    ['1.0.0-a', '1.0.0-b', -1],
  ] as const)('%s vs %s = %i (и симметрично)', (a, b, expected) => {
    expect(compareSemver(a, b)).toBe(expected);
    expect(compareSemver(b, a)).toBe(-expected || 0);
  });

  it('невалидная версия — CatalogFormatError', () => {
    expect(() => compareSemver('x', '1.0.0')).toThrow(CatalogFormatError);
  });
});

describe('satisfiesRange', () => {
  it.each([
    ['1.1.9', '<1.2.0', true],
    ['1.2.0', '<1.2.0', false],
    ['1.2.0', '<=1.2.0', true],
    ['1.2.1', '<=1.2.0', false],
    ['1.2.0', '>=1.2.0', true],
    ['1.1.9', '>=1.2.0', false],
    ['1.2.1', '>1.2.0', true],
    ['1.2.0', '>1.2.0', false],
    ['1.2.0', '=1.2.0', true],
    ['1.2.0', '1.2.0', true],
    ['1.2.1', '1.2.0', false],
    ['1.1.0', '>=1.0.0 <1.2.0', true],
    ['1.2.0', '>=1.0.0 <1.2.0', false],
    ['0.9.0', '>=1.0.0 <1.2.0', false],
    ['1.2.0-rc.1', '<1.2.0', true],
  ] as const)('%s в %j = %s', (version, range, expected) => {
    expect(satisfiesRange(version, range)).toBe(expected);
  });

  it.each([
    '',
    ' ',
    '^1.2.0',
    '~1.2.0',
    '*',
    '1.x',
    '>=1.0',
    '>= 1.0.0',
    '<1.0.0 || >2.0.0',
    '1.0.0 - 2.0.0',
    ' <1.0.0',
    '<1.0.0 ',
  ])('синтаксис %j — CatalogFormatError', (range) => {
    expect(() => satisfiesRange('1.0.0', range)).toThrow(CatalogFormatError);
  });
});
