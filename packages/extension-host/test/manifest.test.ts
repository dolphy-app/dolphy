import { formatDiagnostic } from '../src/diagnostics.ts';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/manifest.ts';

const valid = () => ({
  id: 'acme.quiz',
  version: '1.2.3',
  apiVersion: 1,
  main: './main.mjs',
  client: './client.mjs',
});

const issues = (raw: unknown): string => {
  const result = parseManifest(raw);
  if (result.ok) throw new Error('manifest unexpectedly valid');
  return formatDiagnostic(result.diagnostic);
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
  it('принимает корректный манифест и хранит main и client', () => {
    expect(parseManifest(valid())).toMatchObject({
      ok: true,
      manifest: { main: './main.mjs', client: './client.mjs' },
    });
  });

  it('расширение без main и client пусто, но допустимо', () => {
    const empty = Object.fromEntries(
      Object.entries(valid()).filter(
        ([key]) => key !== 'main' && key !== 'client',
      ),
    );
    expect(parseManifest(empty)).toMatchObject({
      ok: true,
      manifest: { main: null, client: null },
    });
    expect(parseManifest({ ...empty, main: null, client: null })).toMatchObject(
      { ok: true, manifest: { main: null, client: null } },
    );
  });

  it('одна часть без другой: серверная или клиентская', () => {
    expect(parseManifest({ ...valid(), client: null })).toMatchObject({
      ok: true,
      manifest: { main: './main.mjs', client: null },
    });
    expect(parseManifest({ ...valid(), main: null })).toMatchObject({
      ok: true,
      manifest: { main: null, client: './client.mjs' },
    });
  });

  const rejected: [string, unknown][] = [
    ['id не по паттерну', { ...valid(), id: 'Acme_Quiz' }],
    ['id длиннее 64 символов', { ...valid(), id: 'a'.repeat(65) }],
    ['версия не semver', { ...valid(), version: '1.0' }],
    ['версия с ведущим нулём', { ...valid(), version: '01.0.0' }],
    ['main без .mjs', { ...valid(), main: './main.js' }],
    ['client без .mjs', { ...valid(), client: './client.js' }],
    ['.. в пути main', { ...valid(), main: '../main.mjs' }],
    ['.. в пути client', { ...valid(), client: './a/../../c.mjs' }],
    ['обратная косая в пути', { ...valid(), client: '.\\client.mjs' }],
    ['абсолютный путь main', { ...valid(), main: '/main.mjs' }],
    ['apiVersion: 2', { ...valid(), apiVersion: 2 }],
    ['лишнее поле', { ...valid(), extra: true }],
  ];
  it.each(rejected)('отклоняет: %s', (_name, manifest) => {
    expect(issues(manifest).length).toBeGreaterThan(0);
  });
});

describe('вклады регистрирует код', () => {
  it('ключ contributes отклоняется с подсказкой', () => {
    expect(issues({ ...valid(), contributes: { exerciseTypes: [] } })).toBe(
      'contributes: contributions are registered in code (src/index.ts: server, client)',
    );
  });

  it.each(['permissions', 'locales'])(
    'ключ %s отклоняется как неизвестный',
    (key) => {
      expect(issues({ ...valid(), [key]: [] })).toContain(key);
    },
  );
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
        icon: null,
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

describe('название и описание по языкам', () => {
  const withMeta = (patch: Record<string, unknown>) => ({
    ...valid(),
    ...patch,
  });

  it('принимает объект с обоими языками', () => {
    expect(
      parseManifest(
        withMeta({
          name: { en: 'Quiz', ru: 'Опрос' },
          description: { en: 'Questions', ru: 'Вопросы' },
        }),
      ),
    ).toMatchObject({
      ok: true,
      manifest: {
        name: { en: 'Quiz', ru: 'Опрос' },
        description: { en: 'Questions', ru: 'Вопросы' },
      },
    });
  });

  it('принимает объект только с английским и смесь форм', () => {
    expect(
      parseManifest(withMeta({ name: { en: 'Quiz' }, description: 'Вопросы' })),
    ).toMatchObject({
      ok: true,
      manifest: { name: { en: 'Quiz' }, description: 'Вопросы' },
    });
  });

  it.each([
    ['name', {}],
    ['name', { ru: 'Опрос' }],
    ['name', { en: '', ru: 'Опрос' }],
    ['name', { en: 'Quiz', ru: '' }],
    ['name', { en: 'Quiz', de: 'Quiz' }],
    ['name', { en: 'x'.repeat(81), ru: 'Опрос' }],
    ['name', { en: 'Quiz', ru: 'я'.repeat(81) }],
    ['name', { en: 5 }],
    ['description', { en: 'Questions', ru: 'я'.repeat(501) }],
    ['description', { en: 'x'.repeat(501), ru: 'Вопросы' }],
    ['description', { ru: 'Вопросы' }],
    ['description', ['Questions']],
  ])('отклоняет %s = %j', (key, value) => {
    expect(parseManifest(withMeta({ [key]: value })).ok).toBe(false);
  });

  it('называет поле и язык в диагностике', () => {
    expect(issues(withMeta({ name: { en: 'Quiz', ru: '' } }))).toContain(
      'name.ru',
    );
    expect(issues(withMeta({ description: { ru: 'Вопросы' } }))).toContain(
      'description.en',
    );
  });

  it('граничные длины каждого языка принимаются', () => {
    expect(
      parseManifest(
        withMeta({
          name: { en: 'x'.repeat(80), ru: 'я'.repeat(80) },
          description: { en: 'x'.repeat(500), ru: 'я'.repeat(500) },
        }),
      ).ok,
    ).toBe(true);
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
    const text = issues(withTags(['hologram']));
    expect(text).toMatch(/^tags\.0: /);
    expect(text).toContain('learning, language, content');
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
