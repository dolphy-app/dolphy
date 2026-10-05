import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHEDULE_AT,
  ELEMENT_NAME_PATTERN,
  EXTENSION_ID_PATTERN,
  EXTENSION_PERMISSIONS,
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

describe('extension id and element name patterns', () => {
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

  it.each(['dolphy-sql-answer', 'x-y', 'a1-b2'])(
    'accepts element name %s',
    (name) => {
      expect(ELEMENT_NAME_PATTERN.test(name)).toBe(true);
    },
  );

  it.each(['div', 'Dolphy-sql', '-a', 'a-', 'a--b', 'a_b-c'])(
    'rejects element name %j',
    (name) => {
      expect(ELEMENT_NAME_PATTERN.test(name)).toBe(false);
    },
  );
});

describe('EXTENSION_PERMISSIONS', () => {
  it('lists capabilities without repeats as id names', () => {
    for (const permission of EXTENSION_PERMISSIONS) {
      expect(permission).toMatch(/^[a-z]+(\.[a-z]+)?$/);
    }
    expect(new Set(EXTENSION_PERMISSIONS).size).toBe(
      EXTENSION_PERMISSIONS.length,
    );
  });
});
