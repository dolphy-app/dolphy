import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { JsonSchema } from '@dolphy-app/extension-sdk';
import {
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

const spec = { options: ['a', 'b', 'c'], correct: [1] };

const disposables: { dispose(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(disposables.splice(0).map((item) => item.dispose()));
});

const load = async () => {
  const type = await loadExerciseType(module, 'dolphy.choice');
  disposables.push(type);
  return type;
};

describe('dolphy.choice: модуль расширения', () => {
  it('project не раскрывает correct', async () => {
    const type = await load();
    const view = await type.project({ ...spec, multiple: true });
    expect(view).toEqual({ multiple: true, options: spec.options });
    expect(view).not.toHaveProperty('correct');
  });

  it('grade проходит через зарегистрированный вид', async () => {
    const type = await load();
    expect(await type.grade({ spec, answer: [1] })).toEqual({
      outcome: 'passed',
    });
    expect(await type.grade({ spec, answer: [0] })).toEqual({
      outcome: 'failed',
      reason: 'mismatch',
    });
    expect(
      await type.grade({ spec, answer: [0], authorMode: true }),
    ).toMatchObject({ detail: 'expected: 1' });
  });

  it('referenceAnswer отдаёт correct и сам проходит проверку', async () => {
    const type = await load();
    const reference = await type.referenceAnswer(spec);
    expect(reference).toEqual({ found: true, answer: [1] });
    if (!reference.found) throw new Error('reference expected');
    expect(await type.grade({ spec, answer: reference.answer })).toEqual({
      outcome: 'passed',
    });
  });
});

describe('dolphy.choice: схемы', () => {
  it.each([
    ['одиночный', { options: ['a', 'b'], correct: [0] }],
    [
      'множественный',
      { options: ['a', 'b', 'c'], correct: [0, 2], multiple: true },
    ],
  ])('spec: %s допустим', async (_name, value) => {
    const validate = createSchemaValidator(await readSchema('spec.json'));
    expect(validate(value)).toEqual([]);
  });

  it.each([
    ['correct не массив', { options: ['a', 'b'], correct: '0' }],
    ['вариантов меньше двух', { options: ['a'], correct: [0] }],
    [
      'вариантов больше двенадцати',
      { options: Array(13).fill('x'), correct: [0] },
    ],
    ['пустой correct', { options: ['a', 'b'], correct: [] }],
    ['повтор в correct', { options: ['a', 'b'], correct: [0, 0] }],
    ['отрицательный индекс', { options: ['a', 'b'], correct: [-1] }],
    ['пустой текст варианта', { options: ['a', ''], correct: [0] }],
    ['нет options', { correct: [0] }],
    ['лишнее поле', { options: ['a', 'b'], correct: [0], extra: true }],
  ])('spec: %s отклоняется', async (_name, value) => {
    const validate = createSchemaValidator(await readSchema('spec.json'));
    expect(validate(value)).not.toEqual([]);
  });

  it('spec: сообщение указывает на поле', async () => {
    const validate = createSchemaValidator(await readSchema('spec.json'));
    expect(validate({ options: ['a', 'b'], correct: '0' })).toEqual([
      '/correct must be array',
    ]);
  });

  it.each([[[]], [[0]], [[0, 3, 11]]])('answer: %j допустим', async (value) => {
    const validate = createSchemaValidator(await readSchema('answer.json'));
    expect(validate(value)).toEqual([]);
  });

  it.each([
    ['строка', '0'],
    ['повтор', [1, 1]],
    ['дробный индекс', [0.5]],
    ['отрицательный индекс', [-1]],
    ['больше двенадцати', Array.from({ length: 13 }, (_, index) => index)],
  ])('answer: %s отклоняется', async (_name, value) => {
    const validate = createSchemaValidator(await readSchema('answer.json'));
    expect(validate(value)).not.toEqual([]);
  });
});
