import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHEDULE_AT,
  EXTENSION_ID_PATTERN,
  SCHEDULE_AT_PATTERN,
} from '../src/index.ts';

describe('schedule time pattern', () => {
  it.each(['00:00', '09:00', '12:30', '19:59', '23:59'])('accepts %s', (at) => {
    expect(SCHEDULE_AT_PATTERN.test(at)).toBe(true);
  });

  it.each(['', '9:00', '24:00', '23:60', '12:5', '12:300', '12-30', ' 09:00'])(
    'rejects %j',
    (at) => {
      expect(SCHEDULE_AT_PATTERN.test(at)).toBe(false);
    },
  );

  it('the default time is itself a valid time', () => {
    expect(SCHEDULE_AT_PATTERN.test(DEFAULT_SCHEDULE_AT)).toBe(true);
  });
});

describe('extension id pattern', () => {
  it.each(['dolphy.sql', 'acme', 'acme.quiz-pack.choice', 'a1.b2'])(
    'accepts extension id %s',
    (id) => {
      expect(EXTENSION_ID_PATTERN.test(id)).toBe(true);
    },
  );

  it.each([
    '',
    'Dolphy.sql',
    '.sql',
    'dolphy.',
    'dolphy..sql',
    '1dolphy',
    'dolphy_sql',
    'a/b',
  ])('rejects extension id %j', (id) => {
    expect(EXTENSION_ID_PATTERN.test(id)).toBe(false);
  });
});
