import { createSchemaValidator } from '@dolphy-app/extension-sdk/testing';
import { describe, expect, it } from 'vitest';
import { answerSchema, specSchema } from '../src/schema.ts';

describe('dolphy.js: схемы', () => {
  it.each([
    ['только tests', { tests: "test('a', () => {})" }],
    [
      'все поля',
      {
        tests: "test('a', () => {})",
        reference: 'const x = 1;',
        starter: '// code',
        maxOutputChars: 500,
      },
    ],
    ['пустой starter', { tests: 't', starter: '' }],
  ])('spec: %s допустим', (_name, value) => {
    const validate = createSchemaValidator(specSchema);
    expect(validate(value)).toEqual([]);
  });

  it.each([
    ['нет tests', { reference: 'x' }],
    ['пустой tests', { tests: '' }],
    ['tests не строка', { tests: 1 }],
    ['пустой reference', { tests: 't', reference: '' }],
    ['starter не строка', { tests: 't', starter: 1 }],
    ['maxOutputChars дробный', { tests: 't', maxOutputChars: 1.5 }],
    ['maxOutputChars нулевой', { tests: 't', maxOutputChars: 0 }],
    ['лишнее поле', { tests: 't', extra: true }],
  ])('spec: %s отклоняется', (_name, value) => {
    const validate = createSchemaValidator(specSchema);
    expect(validate(value)).not.toEqual([]);
  });

  it('answer: строка до 20000 символов допустима', () => {
    const validate = createSchemaValidator(answerSchema);
    expect(validate('')).toEqual([]);
    expect(validate('x'.repeat(20_000))).toEqual([]);
  });

  it.each([
    ['длиннее 20000', 'x'.repeat(20_001)],
    ['число', 1],
    ['массив', ['code']],
  ])('answer: %s отклоняется', (_name, value) => {
    const validate = createSchemaValidator(answerSchema);
    expect(validate(value)).not.toEqual([]);
  });
});
