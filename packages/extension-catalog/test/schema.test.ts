import { describe, expect, it } from 'vitest';
import { CatalogFormatError, parseIndex } from '../src/index.ts';
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

  it('сводка принимает необязательные settings и events', () => {
    const base = entry().contributes;
    const withKeys = entry({
      contributes: { ...base, settings: ['acme.quiz.mode'], events: [] },
    });
    const parsed = parseIndex(index([withKeys]));
    expect(parsed.extensions[0]?.contributes.settings).toEqual([
      'acme.quiz.mode',
    ]);
  });

  it('сводка без settings и events остаётся валидной', () => {
    const parsed = parseIndex(index());
    expect(parsed.extensions[0]?.contributes.settings).toBeUndefined();
    expect(parsed.extensions[0]?.contributes.events).toBeUndefined();
  });

  it('settings и events неверного типа отвергаются', () => {
    const base = entry().contributes;
    const bad = (key: string, value: unknown) =>
      issuesOf(index([{ ...entry(), contributes: { ...base, [key]: value } }]));
    expect(bad('settings', 'acme.quiz.mode')[0]).toContain(
      'extensions.0.contributes.settings',
    );
    expect(bad('events', [1])[0]).toContain('extensions.0.contributes.events');
  });

  it('сводка принимает commands и panels и сохраняет их', () => {
    const base = entry().contributes;
    const raw = index([
      entry({
        contributes: {
          ...base,
          commands: ['acme.quiz.open'],
          panels: ['acme.quiz.main'],
        },
      }),
    ]);
    const parsed = parseIndex(raw);
    expect(parsed.extensions[0]?.contributes.commands).toEqual([
      'acme.quiz.open',
    ]);
    expect(parsed.extensions[0]?.contributes.panels).toEqual([
      'acme.quiz.main',
    ]);
    expect(parseIndex(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it('старый индекс без commands и panels остаётся валидным', () => {
    const parsed = parseIndex(index());
    expect(parsed.extensions[0]?.contributes.commands).toBeUndefined();
    expect(parsed.extensions[0]?.contributes.panels).toBeUndefined();
  });

  it('commands и panels неверного типа отвергаются', () => {
    const base = entry().contributes;
    const bad = (key: string, value: unknown) =>
      issuesOf(index([{ ...entry(), contributes: { ...base, [key]: value } }]));
    expect(bad('commands', [1])[0]).toContain(
      'extensions.0.contributes.commands',
    );
    expect(bad('panels', 'acme.quiz.main')[0]).toContain(
      'extensions.0.contributes.panels',
    );
  });

  it('неизвестный ключ сводки по-прежнему отвергается', () => {
    const base = entry().contributes;
    const raw = index([
      { ...entry(), contributes: { ...base, widgets: ['x'] } },
    ]);
    expect(issuesOf(raw)[0]).toContain('extensions.0.contributes');
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

  it('автор, платформа, разрешение, minAppVersion', () => {
    expect(issuesOf(index([entry({ author: '-x' })]))).not.toEqual([]);
    expect(
      issuesOf(index([entry({ platforms: ['bsd' as never] })])),
    ).not.toEqual([]);
    expect(issuesOf(withVersion({ permissions: ['root'] }))).not.toEqual([]);
    expect(issuesOf(withVersion({ minAppVersion: '1.0' }))).not.toEqual([]);
    expect(issuesOf(withVersion({ minAppVersion: '1.0.0' }))).toEqual([]);
  });
});
