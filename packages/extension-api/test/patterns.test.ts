import { describe, expect, it } from 'vitest';
import {
  ELEMENT_NAME_PATTERN,
  EXTENSION_ID_PATTERN,
  EXTENSION_PERMISSIONS,
} from '../src/index.ts';

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
    expect(EXTENSION_PERMISSIONS).toEqual([
      'library.read',
      'process.spawn',
      'worker.threads',
      'native.addons',
      'network',
      'learning.events',
    ]);
    expect(new Set(EXTENSION_PERMISSIONS).size).toBe(
      EXTENSION_PERMISSIONS.length,
    );
  });
});
