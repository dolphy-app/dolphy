import { describe, expect, it } from 'vitest';
import { normalizeManifest, parseManifest } from '../src/manifest.ts';

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
    ['пустая схема-объект', withType({ specSchema: {} })],
    ['схема неверного типа', withType({ answerSchema: 42 })],
    ['явный element с плохим именем', withType({ element: 'Quiz_Answer' })],
    ['main: null', { ...valid(), main: null }],
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

const minimal = () => ({
  id: 'acme.quiz',
  version: '1.0.0',
  apiVersion: 1,
  contributes: {
    exerciseTypes: [
      {
        id: 'acme.quiz',
        specSchema: { type: 'object' },
        answerSchema: './schema/answer.json',
      },
    ],
  },
});

describe('минимальный манифест', () => {
  it('применяет умолчания main, renderer и element', () => {
    const result = parseManifest(minimal());
    expect(result).toMatchObject({
      ok: true,
      manifest: {
        main: './main.mjs',
        contributes: {
          exerciseTypes: [
            { element: 'acme-quiz-answer', renderer: './view.mjs' },
          ],
        },
      },
    });
  });

  it('сохраняет встроенную схему и путь к схеме как есть', () => {
    const result = parseManifest(minimal());
    if (!result.ok) throw new Error(result.message);
    expect(result.manifest.contributes.exerciseTypes[0]).toMatchObject({
      specSchema: { type: 'object' },
      answerSchema: './schema/answer.json',
    });
  });

  it('явные значения важнее умолчаний', () => {
    const raw = minimal();
    Object.assign(raw, { main: './dist/main.mjs' });
    Object.assign(raw.contributes.exerciseTypes[0]!, {
      element: 'my-el',
      renderer: './ui.js',
    });
    const result = parseManifest(raw);
    expect(result).toMatchObject({
      ok: true,
      manifest: {
        main: './dist/main.mjs',
        contributes: {
          exerciseTypes: [{ element: 'my-el', renderer: './ui.js' }],
        },
      },
    });
  });

  it('выведенный element обязан быть допустимым тегом', () => {
    const raw = minimal();
    raw.contributes.exerciseTypes[0]!.id = 'acme';
    raw.id = 'acme';
    expect(parseManifest(raw).ok).toBe(true);
    const bad = minimal();
    bad.id = 'acme-';
    bad.contributes.exerciseTypes[0]!.id = 'acme-';
    const result = parseManifest(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(
        "contributes.exerciseTypes.0.element: invalid element name 'acme--answer'",
      );
    }
  });
});

describe('normalizeManifest', () => {
  it('не меняет вход', () => {
    const input = minimal() as Parameters<typeof normalizeManifest>[0];
    const before = structuredClone(input);
    normalizeManifest(input);
    expect(input).toEqual(before);
  });
});
