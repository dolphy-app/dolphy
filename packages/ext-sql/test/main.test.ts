import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { JsonSchema } from '@dolphy-app/extension-sdk';
import {
  createMemoryLibrary,
  createSchemaValidator,
  loadExerciseType,
} from '@dolphy-app/extension-sdk/testing';
import { afterEach, describe, expect, it } from 'vitest';
import module from '../src/main.ts';

const readSchema = async (name: string): Promise<JsonSchema> =>
  JSON.parse(
    await readFile(
      fileURLToPath(new URL(`../schema/${name}`, import.meta.url)),
      'utf8',
    ),
  ) as JsonSchema;

const disposables: { dispose(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(disposables.splice(0).map((item) => item.dispose()));
});

const load = async (files: Record<string, string> = {}) => {
  const type = await loadExerciseType(module, 'dolphy.sql', {
    library: createMemoryLibrary(files),
  });
  disposables.push(type);
  return type;
};

const spec = { fixture: 'fixtures/emp.sql', expected: 'checks/q1.csv' };

describe('dolphy.sql: модуль расширения', () => {
  it('project не требует данных', async () => {
    const type = await load();
    expect(await type.project(spec)).toEqual({});
  });

  it('referenceAnswer читает эталон из библиотеки и обрезает пробелы', async () => {
    const type = await load({ 'solutions/q1.sql': 'select 1;\n' });
    expect(
      await type.referenceAnswer({ ...spec, reference: 'solutions/q1.sql' }),
    ).toEqual({ found: true, answer: 'select 1;' });
  });

  it('referenceAnswer без reference — эталона нет', async () => {
    const type = await load();
    expect(await type.referenceAnswer(spec)).toEqual({ found: false });
  });

  it.each(['../secret.sql', '/etc/passwd', 'a\\b.sql'])(
    'referenceAnswer отклоняет небезопасный путь %s',
    async (reference) => {
      const type = await load({ [reference]: 'select 1' });
      await expect(
        type.referenceAnswer({ ...spec, reference }),
      ).rejects.toThrow('reference path is not safe');
    },
  );

  it('deactivate освобождает раннер: повторная загрузка работает', async () => {
    const first = await load();
    await first.dispose();
    const second = await load({ 'solutions/q1.sql': 'select 2' });
    expect(
      await second.referenceAnswer({ ...spec, reference: 'solutions/q1.sql' }),
    ).toEqual({ found: true, answer: 'select 2' });
  });
});

describe('dolphy.sql: схемы', () => {
  it.each([
    ['минимальный', spec],
    [
      'со всеми параметрами',
      {
        ...spec,
        reference: 'solutions/q1.sql',
        orderSensitive: true,
        ignoreColumnNames: false,
        numericTolerance: 0.01,
        columnOrder: 'any',
        maxRows: 100,
        maxBytes: 1000,
      },
    ],
  ])('spec: %s допустим', async (_name, value) => {
    const validate = createSchemaValidator(await readSchema('spec.json'));
    expect(validate(value)).toEqual([]);
  });

  it.each([
    ['нет expected', { fixture: 'fixtures/emp.sql' }],
    ['пустой fixture', { ...spec, fixture: '' }],
    ['columnOrder вне enum', { ...spec, columnOrder: 'random' }],
    ['maxRows ноль', { ...spec, maxRows: 0 }],
    ['maxBytes больше предела', { ...spec, maxBytes: 10_000_001 }],
    ['лишнее поле', { ...spec, runner: 'sql' }],
  ])('spec: %s отклоняется', async (_name, value) => {
    const validate = createSchemaValidator(await readSchema('spec.json'));
    expect(validate(value)).not.toEqual([]);
  });

  it('answer: принимает строку и отклоняет остальное', async () => {
    const validate = createSchemaValidator(await readSchema('answer.json'));
    expect(validate('select 1')).toEqual([]);
    expect(validate(['select 1'])).not.toEqual([]);
    expect(validate(null)).not.toEqual([]);
  });
});
