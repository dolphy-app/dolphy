import { formatDiagnostic } from '../src/diagnostics.ts';
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

describe('$schema', () => {
  it('принимается и не попадает в нормализованный манифест', () => {
    const result = parseManifest({
      ...valid(),
      $schema: './extension.schema.json',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest).not.toHaveProperty('$schema');
  });

  it('только строка', () => {
    expect(parseManifest({ ...valid(), $schema: 1 }).ok).toBe(false);
  });
});

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
    ['версия с ведущим нулём', { ...valid(), version: '01.0.0' }],
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
    ['ключ element', withType({ element: 'acme-quiz-answer' })],
    ['main: null', { ...valid(), main: null }],
    ['пустой список видов', { ...valid(), contributes: { exerciseTypes: [] } }],
    ['лишнее поле', { ...valid(), extra: true }],
  ];
  it.each(rejected)('отклоняет: %s', (_name, manifest) => {
    const result = parseManifest(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(formatDiagnostic(result.diagnostic).length).toBeGreaterThan(0);
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
  it('применяет умолчания main и renderer', () => {
    const result = parseManifest(minimal());
    expect(result).toMatchObject({
      ok: true,
      manifest: {
        main: './main.mjs',
        contributes: {
          exerciseTypes: [{ renderer: './view.mjs' }],
        },
      },
    });
  });

  it('сохраняет встроенную схему и путь к схеме как есть', () => {
    const result = parseManifest(minimal());
    if (!result.ok) throw new Error(formatDiagnostic(result.diagnostic));
    expect(result.manifest.contributes.exerciseTypes[0]).toMatchObject({
      specSchema: { type: 'object' },
      answerSchema: './schema/answer.json',
    });
  });

  it('явные значения важнее умолчаний', () => {
    const raw = minimal();
    Object.assign(raw, { main: './dist/main.mjs' });
    Object.assign(raw.contributes.exerciseTypes[0]!, {
      renderer: './ui.js',
    });
    const result = parseManifest(raw);
    expect(result).toMatchObject({
      ok: true,
      manifest: {
        main: './dist/main.mjs',
        contributes: {
          exerciseTypes: [{ renderer: './ui.js' }],
        },
      },
    });
  });

  it('один файл может нести вид, виджет, панель и рендерер markdown', () => {
    const result = parseManifest({
      ...minimal(),
      contributes: {
        ...minimal().contributes,
        panels: [
          { id: 'acme.quiz.screen', title: 'Screen', module: './ui.mjs' },
        ],
        widgets: [
          {
            id: 'acme.quiz.card',
            title: 'Card',
            slot: 'dailyPlan',
            module: './ui.mjs',
          },
        ],
        markdownRenderers: [{ language: 'quiz', renderer: './ui.mjs' }],
      },
    });
    if (!result.ok) throw new Error(formatDiagnostic(result.diagnostic));
    expect(result.manifest.contributes.widgets[0]?.module).toBe('./ui.mjs');
  });
});

describe('permissions', () => {
  const withPermissions = (permissions: unknown) => ({
    ...valid(),
    permissions,
  });

  it('по умолчанию пусто', () => {
    const result = parseManifest(valid());
    expect(result).toMatchObject({ ok: true, manifest: { permissions: [] } });
  });

  it('принимает все объявленные возможности', () => {
    const all = [
      'library.read',
      'process.spawn',
      'worker.threads',
      'native.addons',
      'network',
    ];
    expect(parseManifest(withPermissions(all))).toMatchObject({
      ok: true,
      manifest: { permissions: all },
    });
  });

  it.each([
    ['неизвестное имя', ['library.write']],
    ['не массив', 'network'],
    ['не строка', [1]],
  ])('отклоняет: %s, сообщение — путь и причина', (_name, permissions) => {
    const result = parseManifest(withPermissions(permissions));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(formatDiagnostic(result.diagnostic)).toMatch(
        /^permissions(\.\d+)?: /,
      );
  });

  it('отклоняет дубль, называя разрешение', () => {
    const result = parseManifest(withPermissions(['network', 'network']));
    expect(result).toEqual({
      ok: false,
      diagnostic: {
        code: 'manifest-invalid',
        data: { issues: ["permissions.1: duplicate permission 'network'"] },
      },
    });
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

describe('метаданные и совместимость', () => {
  const withMeta = (patch: Record<string, unknown>) => ({
    ...valid(),
    ...patch,
  });

  it('по умолчанию null и пустые платформы', () => {
    expect(parseManifest(valid())).toMatchObject({
      ok: true,
      manifest: {
        name: null,
        description: null,
        author: null,
        platforms: [],
        minAppVersion: null,
      },
    });
  });

  it('принимает корректные значения', () => {
    const result = parseManifest(
      withMeta({
        name: 'Quiz',
        description: 'Вопросы',
        author: 'octo-cat',
        platforms: ['darwin', 'win32'],
        minAppVersion: '1.2.3',
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      manifest: {
        name: 'Quiz',
        author: 'octo-cat',
        platforms: ['darwin', 'win32'],
        minAppVersion: '1.2.3',
      },
    });
  });

  it.each([
    ['name', ''],
    ['name', 'x'.repeat(81)],
    ['description', ''],
    ['description', 'x'.repeat(501)],
    ['author', '-bad'],
    ['author', 'a'.repeat(40)],
    ['author', 'has space'],
    ['platforms', ['freebsd']],
    ['platforms', ['linux', 'linux']],
    ['tags', ['hologram']],
    ['tags', ['theme', 'theme']],
    [
      'tags',
      ['learning', 'language', 'content', 'theme', 'interface', 'developer'],
    ],
    ['tags', 'theme'],
    ['minAppVersion', '1.2'],
    ['minAppVersion', '01.2.3'],
    ['minAppVersion', '1.2.3+build'],
  ])('отклоняет %s = %j', (key, value) => {
    expect(parseManifest(withMeta({ [key]: value })).ok).toBe(false);
  });

  it('граничные длины принимаются', () => {
    expect(
      parseManifest(
        withMeta({
          name: 'x'.repeat(80),
          description: 'x'.repeat(500),
          author: 'a'.repeat(39),
        }),
      ).ok,
    ).toBe(true);
  });

  it('неизвестный ключ по-прежнему отвергается', () => {
    expect(parseManifest(withMeta({ homepage: 'x' })).ok).toBe(false);
  });
});

describe('tags', () => {
  const withTags = (tags: unknown) => ({ ...valid(), tags });

  it('accepts up to five unique tags and normalizes the absent key to []', () => {
    const five = ['learning', 'language', 'content', 'theme', 'interface'];
    const parsed = parseManifest(withTags(five));
    expect(parsed.ok && parsed.manifest.tags).toEqual(five);
    const absent = parseManifest(valid());
    expect(absent.ok && absent.manifest.tags).toEqual([]);
  });

  it('names the field and the vocabulary for an unknown tag', () => {
    const result = parseManifest(withTags(['hologram']));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(formatDiagnostic(result.diagnostic)).toMatch(/^tags\.0: /);
      expect(formatDiagnostic(result.diagnostic)).toContain(
        'learning, language, content',
      );
    }
  });

  it('names the duplicate tag', () => {
    expect(parseManifest(withTags(['theme', 'theme']))).toEqual({
      ok: false,
      diagnostic: {
        code: 'manifest-invalid',
        data: { issues: ["tags.1: duplicate tag 'theme'"] },
      },
    });
  });
});
