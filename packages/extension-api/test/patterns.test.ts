import { describe, expect, it } from 'vitest';
import { ELEMENT_NAME_PATTERN, EXTENSION_ID_PATTERN } from '../src/index.ts';

describe('extension id and element name patterns', () => {
  it.each(['lms.sql', 'acme', 'acme.quiz-pack.choice', 'a1.b2'])(
    'accepts extension id %s',
    (id) => {
      expect(EXTENSION_ID_PATTERN.test(id)).toBe(true);
    },
  );

  it.each([
    '',
    'Lms.sql',
    '.sql',
    'lms.',
    'lms..sql',
    '1lms',
    'lms_sql',
    'a/b',
  ])('rejects extension id %j', (id) => {
    expect(EXTENSION_ID_PATTERN.test(id)).toBe(false);
  });

  it.each(['lms-sql-answer', 'x-y', 'a1-b2'])(
    'accepts element name %s',
    (name) => {
      expect(ELEMENT_NAME_PATTERN.test(name)).toBe(true);
    },
  );

  it.each(['div', 'Lms-sql', '-a', 'a-', 'a--b', 'a_b-c'])(
    'rejects element name %j',
    (name) => {
      expect(ELEMENT_NAME_PATTERN.test(name)).toBe(false);
    },
  );
});
