import { describe, expect, it } from 'vitest';
import {
  CatalogFormatError,
  parseDeprecatedList,
  parseIndex,
  parseIndexLenient,
} from '../src/index.ts';
import { entry, index, sha, version } from './fixtures.ts';

const issuesOf = (raw: unknown): string[] => {
  try {
    parseIndex(raw);
  } catch (error) {
    if (error instanceof CatalogFormatError) return error.issues;
    throw error;
  }
  return [];
};

const withVersion = (overrides: Record<string, unknown>): unknown =>
  index([entry({ versions: [version(overrides as never)] })]);

const withFiles = (files: unknown[]): unknown => withVersion({ files });

const file = (path: string, size = 1) => ({ path, size, sha256: sha('c') });
const manifestFile = file('extension.json');

describe('parseIndex', () => {
  it('принимает корректный индекс', () => {
    const parsed = parseIndex(index());
    expect(parsed.extensions[0]?.id).toBe('acme.quiz');
    expect(parsed.revoked).toHaveLength(1);
  });

  it('вклады расширения в записи индекса — неизвестный ключ', () => {
    const raw = index([{ ...entry(), contributes: { exerciseTypes: [] } }]);
    expect(issuesOf(raw)[0]).toContain('extensions.0');
  });

  describe('dependencies of a version', () => {
    const deps = (value: unknown) => withVersion({ dependencies: value });

    it('are optional and kept with and without a range', () => {
      const parsed = parseIndex(
        deps([
          { id: 'acme.base' },
          { id: 'acme.lib', range: '>=1.0.0 <2.0.0' },
        ]),
      );
      expect(parsed.extensions[0]?.versions[0]?.dependencies).toEqual([
        { id: 'acme.base' },
        { id: 'acme.lib', range: '>=1.0.0 <2.0.0' },
      ]);
      expect(
        parseIndex(index()).extensions[0]?.versions[0]?.dependencies,
      ).toBeUndefined();
    });

    it.each([
      ['a repeated id', [{ id: 'acme.a' }, { id: 'acme.a' }]],
      ['an unreadable range', [{ id: 'acme.a', range: 'newer' }]],
      ['a bad id', [{ id: 'Bad Id' }]],
      ['an unknown key', [{ id: 'acme.a', optional: true }]],
      [
        'more than 16',
        Array.from({ length: 17 }, (_, i) => ({ id: `acme.d${i}` })),
      ],
      ['a non-array', 'acme.a'],
    ])('are rejected by the strict reader with %s', (_name, value) => {
      expect(issuesOf(deps(value))[0]).toContain(
        'extensions.0.versions.0.dependencies',
      );
    });

    it('are dropped by the tolerant reader when unreadable, the version stays', () => {
      const { index: parsed } = parseIndexLenient(
        deps([{ id: 'acme.a', range: 'newer' }]),
      );
      expect(parsed.extensions[0]?.versions).toHaveLength(1);
      expect(parsed.extensions[0]?.versions[0]?.dependencies).toEqual([]);
    });
  });

  it('неизвестный ключ отвергается', () => {
    const raw = index([{ ...entry(), extra: 1 }]);
    expect(issuesOf(raw)[0]).toContain('extensions.0');
  });

  it('другая schemaVersion отвергается', () => {
    expect(issuesOf({ ...(index() as object), schemaVersion: 3 })).not.toEqual(
      [],
    );
  });

  it('ошибки несут путь и их не больше 10', () => {
    const many = Array.from({ length: 15 }, () => ({ bad: true }));
    const issues = issuesOf(index(many));
    expect(issues).toHaveLength(10);
    expect(issues[0]).toMatch(/^extensions\.0/);
  });

  it('плохой sha256', () => {
    const issues = issuesOf(
      withFiles([manifestFile, { path: 'main.mjs', size: 1, sha256: 'ABC' }]),
    );
    expect(issues.join()).toContain('sha256');
  });

  it('дубли версий и неотсортированные версии', () => {
    const dup = index([entry({ versions: [version(), version()] })]);
    expect(issuesOf(dup).join()).toContain('duplicate version');
    const unsorted = index([
      entry({
        versions: [
          version({ version: '1.0.0' }),
          version({ version: '1.1.0' }),
        ],
      }),
    ]);
    expect(issuesOf(unsorted).join()).toContain('newest first');
  });

  it('пререлиз младше релиза в сортировке', () => {
    const sorted = index([
      entry({
        versions: [
          version({ version: '1.0.0' }),
          version({ version: '1.0.0-rc.1' }),
        ],
      }),
    ]);
    expect(issuesOf(sorted)).toEqual([]);
  });

  it('больше 5 версий', () => {
    const versions = ['6', '5', '4', '3', '2', '1'].map((n) =>
      version({ version: `${n}.0.0` }),
    );
    expect(issuesOf(index([entry({ versions })]))).not.toEqual([]);
    expect(issuesOf(index([entry({ versions: versions.slice(1) })]))).toEqual(
      [],
    );
  });

  it('нет extension.json', () => {
    expect(issuesOf(withFiles([file('main.mjs')])).join()).toContain(
      'extension.json is required',
    );
  });

  it.each([
    '../x.json',
    'a/../b.json',
    '/abs.json',
    'a\\b.json',
    '.hidden.json',
    'dir/.git/x.json',
    'a//b.json',
    'noext',
    'run.exe',
    `${'a'.repeat(200)}.json`,
  ])('небезопасный путь %j', (path) => {
    expect(issuesOf(withFiles([manifestFile, file(path)]))).not.toEqual([]);
  });

  it('безопасные вложенные пути и расширения', () => {
    const files = ['schema/spec.json', 'a.js', 'b.mjs', 'README.md', 'n.txt'];
    expect(
      issuesOf(withFiles([manifestFile, ...files.map((p) => file(p))])),
    ).toEqual([]);
  });

  it('больше 50 файлов', () => {
    const files = Array.from({ length: 50 }, (_, i) => file(`f${i}.json`));
    expect(issuesOf(withFiles(files))).not.toEqual([]);
    expect(issuesOf(withFiles([manifestFile, ...files.slice(1)]))).toEqual([]);
  });

  it('дубли путей', () => {
    expect(issuesOf(withFiles([manifestFile, manifestFile])).join()).toContain(
      'duplicate path',
    );
  });

  it('потолок размера: файл и сумма', () => {
    expect(
      issuesOf(withFiles([file('extension.json', 10_000_001)])),
    ).not.toEqual([]);
    const half = 5_000_001;
    expect(
      issuesOf(
        withFiles([file('extension.json', half), file('a.js', half)]),
      ).join(),
    ).toContain('total size');
    expect(
      issuesOf(
        withFiles([file('extension.json', 5_000_000), file('a.js', 5_000_000)]),
      ),
    ).toEqual([]);
  });

  it.each([
    'https://example.com/x/',
    'http://127.0.0.1:8080/x/',
    '//example.com/x/',
    '/x/',
    'x',
    '../x/',
    'a/./b/',
    'a//b/',
    'a b/',
    'x/?q=1/',
    '',
  ])('плохой baseUrl %j', (baseUrl) => {
    expect(issuesOf(withVersion({ baseUrl }))).not.toEqual([]);
  });

  it('baseUrl — относительный каталог: подходит локальному http-каталогу', () => {
    expect(issuesOf(withVersion({ baseUrl: 'extensions/a.b/1.0.0/' }))).toEqual(
      [],
    );
  });

  it.each([
    'a:stream.json',
    'a b.json',
    'con.json',
    'NUL.txt',
    'lpt1.md',
    'dir./x.json',
  ])('небезопасное имя для Windows/NTFS %j', (path) => {
    expect(issuesOf(withFiles([manifestFile, file(path)]))).not.toEqual([]);
  });

  it('пути, совпадающие без учёта регистра, — дубль', () => {
    expect(
      issuesOf(
        withFiles([manifestFile, file('Main.mjs'), file('main.mjs')]),
      ).join(),
    ).toContain('duplicate path');
  });

  it('файл не может быть каталогом другого файла', () => {
    expect(
      issuesOf(
        withFiles([manifestFile, file('x.json'), file('x.json/y.json')]),
      ).join(),
    ).toContain('lies inside a file');
  });

  it.each(['<1.x', '^1.0.0', '', '>= 1.0.0'])(
    'плохой диапазон отзыва %j',
    (range) => {
      const raw = {
        ...(index() as object),
        revoked: [{ id: 'acme.bad', versions: range, reason: 'r' }],
      };
      expect(issuesOf(raw).join()).toContain('revoked.0.versions');
    },
  );

  it('автор, платформа, minAppVersion', () => {
    expect(issuesOf(index([entry({ author: '-x' })]))).not.toEqual([]);
    expect(
      issuesOf(index([entry({ platforms: ['bsd' as never] })])),
    ).not.toEqual([]);
    expect(issuesOf(withVersion({ minAppVersion: '1.0' }))).not.toEqual([]);
    expect(issuesOf(withVersion({ minAppVersion: '1.0.0' }))).toEqual([]);
  });
});

describe('deprecated', () => {
  const withDeprecated = (deprecated: unknown) =>
    index([{ ...entry(), deprecated }]);
  const good = {
    versions: '<2.0.0',
    reason: 'Replaced',
    alternatives: ['acme.new'],
  };

  it('строгий разбор принимает запись с диапазоном и без него', () => {
    expect(parseIndex(withDeprecated(good)).extensions[0]?.deprecated).toEqual(
      good,
    );
    expect(
      parseIndex(withDeprecated({ ...good, versions: null })).extensions[0]
        ?.deprecated?.versions,
    ).toBeNull();
  });

  it('строгий разбор отвергает пустую и длинную причину, 4 альтернативы, неверный диапазон и лишние ключи', () => {
    for (const bad of [
      { ...good, reason: '' },
      { ...good, reason: 'x'.repeat(201) },
      { ...good, alternatives: ['a.a', 'a.b', 'a.c', 'a.d'] },
      { ...good, alternatives: ['Not An Id'] },
      { ...good, versions: 'nonsense' },
      { ...good, extra: true },
    ]) {
      expect(issuesOf(withDeprecated(bad)), JSON.stringify(bad)).not.toEqual(
        [],
      );
    }
  });

  it('терпимый разбор отбрасывает нечитаемое deprecated, запись остаётся', () => {
    const { index: parsed } = parseIndexLenient(
      withDeprecated({ ...good, reason: '' }),
    );
    expect(parsed.extensions).toHaveLength(1);
    expect(parsed.extensions[0]?.deprecated).toBeUndefined();
    expect(
      parseIndexLenient(withDeprecated(good)).index.extensions[0]?.deprecated,
    ).toEqual(good);
  });

  it('parseDeprecatedList: повтор id — ошибка', () => {
    const item = { id: 'acme.quiz', reason: 'x', alternatives: [] };
    expect(parseDeprecatedList([item])).toEqual([item]);
    expect(() => parseDeprecatedList([item, item])).toThrow(/duplicate id/);
  });
});

describe('i18n of an entry', () => {
  const withI18n = (i18n: unknown) => index([{ ...entry(), i18n }]);
  const good = { ru: { name: 'Опрос', description: 'Вопросы с ответами' } };

  it('строгий разбор принимает русские название и описание, вместе или порознь', () => {
    expect(parseIndex(withI18n(good)).extensions[0]?.i18n).toEqual(good);
    expect(
      parseIndex(withI18n({ ru: { name: 'Опрос' } })).extensions[0]?.i18n,
    ).toEqual({ ru: { name: 'Опрос' } });
    expect(parseIndex(index()).extensions[0]?.i18n).toBeUndefined();
  });

  it('строгий разбор отвергает пустой объект, пустой и длинный текст, чужой язык и лишние ключи', () => {
    for (const bad of [
      {},
      { ru: {} },
      { ru: { name: '' } },
      { ru: { name: 'я'.repeat(81) } },
      { ru: { description: 'я'.repeat(501) } },
      { ru: { name: 'Опрос' }, de: { name: 'Quiz' } },
      { ru: { name: 'Опрос', title: 'x' } },
      { en: { name: 'Quiz' } },
      'Опрос',
    ]) {
      expect(issuesOf(withI18n(bad)), JSON.stringify(bad)).not.toEqual([]);
    }
  });

  it('терпимый разбор читает русский текст и отбрасывает нечитаемое i18n, запись остаётся', () => {
    expect(parseIndexLenient(withI18n(good)).index.extensions[0]?.i18n).toEqual(
      good,
    );
    const broken = parseIndexLenient(withI18n({ ru: { name: '' } })).index;
    expect(broken.extensions).toHaveLength(1);
    expect(broken.extensions[0]?.i18n).toBeUndefined();
    expect(parseIndexLenient(withI18n('Опрос')).index.extensions[0]?.name).toBe(
      entry().name,
    );
  });
});
