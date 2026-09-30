import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/manifest.ts';

const valid = () => ({
  id: 'acme.quiz',
  version: '1.2.3',
  apiVersion: 1,
  main: './main.mjs',
  contributes: {
    exerciseTypes: [
      {
        id: 'acme.quiz.multi',
        specSchema: './schema/spec.json',
        answerSchema: './schema/answer.json',
        element: 'acme-quiz-answer',
        renderer: './view.mjs',
      },
    ],
  },
});

const withType = (patch: Record<string, unknown>) => {
  const manifest = valid();
  Object.assign(manifest.contributes.exerciseTypes[0]!, patch);
  return manifest;
};

describe('parseManifest', () => {
  it('принимает корректный манифест', () => {
    const result = parseManifest(valid());
    expect(result.ok).toBe(true);
  });

  it('принимает вид, равный id расширения', () => {
    expect(parseManifest(withType({ id: 'acme.quiz' })).ok).toBe(true);
  });

  const rejected: [string, unknown][] = [
    ['id не по паттерну', { ...valid(), id: 'Acme_Quiz' }],
    ['id длиннее 64 символов', { ...valid(), id: 'a'.repeat(65) }],
    ['версия не semver', { ...valid(), version: '1.0' }],
    ['вид вне префикса расширения', withType({ id: 'other.quiz' })],
    ['вид с общим началом без точки', withType({ id: 'acme.quizzes' })],
    ['main без .mjs', { ...valid(), main: './main.js' }],
    ['.. в пути main', { ...valid(), main: '../main.mjs' }],
    ['.. в пути схемы', withType({ specSchema: './a/../../s.json' })],
    ['обратная косая в пути', withType({ renderer: '.\\view.mjs' })],
    ['абсолютный путь renderer', withType({ renderer: '/view.mjs' })],
    ['apiVersion: 2', { ...valid(), apiVersion: 2 }],
    [
      'схема объектом вместо пути',
      withType({ specSchema: { type: 'object' } }),
    ],
    ['element без дефиса', withType({ element: 'quiz' })],
    ['пустой список видов', { ...valid(), contributes: { exerciseTypes: [] } }],
    ['лишнее поле', { ...valid(), extra: true }],
  ];
  it.each(rejected)('отклоняет: %s', (_name, manifest) => {
    const result = parseManifest(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
  });
});
