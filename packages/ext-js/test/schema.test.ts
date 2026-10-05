import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { JsonSchema } from '@dolphy-app/extension-sdk';
import { createSchemaValidator } from '@dolphy-app/extension-sdk/testing';
import { describe, expect, it } from 'vitest';

const readSchema = async (name: string): Promise<JsonSchema> =>
  JSON.parse(
    await readFile(
      fileURLToPath(new URL(`../schema/${name}`, import.meta.url)),
      'utf8',
    ),
  ) as JsonSchema;

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
  ])('spec: %s допустим', async (_name, value) => {
    const validate = createSchemaValidator(await readSchema('spec.json'));
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
  ])('spec: %s отклоняется', async (_name, value) => {
    const validate = createSchemaValidator(await readSchema('spec.json'));
    expect(validate(value)).not.toEqual([]);
  });

  it('answer: строка до 20000 символов допустима', async () => {
    const validate = createSchemaValidator(await readSchema('answer.json'));
    expect(validate('')).toEqual([]);
    expect(validate('x'.repeat(20_000))).toEqual([]);
  });

  it.each([
    ['длиннее 20000', 'x'.repeat(20_001)],
    ['число', 1],
    ['массив', ['code']],
  ])('answer: %s отклоняется', async (_name, value) => {
    const validate = createSchemaValidator(await readSchema('answer.json'));
    expect(validate(value)).not.toEqual([]);
  });
});
