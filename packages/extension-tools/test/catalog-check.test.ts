import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { checkCatalog, formatFinding } from '../src/catalog/check.ts';
import type { CheckOptions } from '../src/catalog/check.ts';
import { createGithubChecker } from '../src/catalog/github.ts';
import { RULES } from '../src/catalog/rules.ts';
import { CatalogUsageError } from '../src/errors.ts';
import {
  createRepo,
  renameDir,
  setVersion,
  writePublished,
} from './catalog-helpers.ts';
import type { ExtensionSpec, Repo } from './catalog-helpers.ts';

const ID = 'acme.night';

const run = async (
  repo: Repo,
  options: Partial<CheckOptions> = {},
): Promise<string[]> => {
  const findings = await checkCatalog({
    extensionsDir: repo.extensionsDir,
    skipGithubCheck: true,
    ...options,
  });
  return findings.map(formatFinding);
};

const single = (spec: Partial<ExtensionSpec> = {}) =>
  createRepo([{ fixture: 'theme-only', ...spec }]);

const expectRule = async (
  spec: Partial<ExtensionSpec>,
  rule: string,
  severity = 'error',
  options: Partial<CheckOptions> = {},
): Promise<string> => {
  const lines = await run(await single(spec), options);
  const hit = lines.find((line) => line.includes(` ${rule} `));
  expect(hit, lines.join('\n')).toBeDefined();
  expect(hit?.startsWith(`${severity} ${ID} ${rule} `)).toBe(true);
  return hit as string;
};

describe('catalog check: правила', () => {
  it('корректный проект не даёт замечаний; все правила перечислены с заголовками', async () => {
    expect(await run(await single())).toEqual([]);
    const ids = RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('CHECK-001');
    expect(RULES.every((rule) => rule.title.length > 0)).toBe(true);
  });

  it('CHECK-001: нечитаемый и неверный манифест', async () => {
    await expectRule({ files: { 'extension.json': '{}' } }, 'CHECK-001');
    await expectRule({ files: { 'extension.json': null } }, 'CHECK-001');
  });

  it('CHECK-002: имя каталога не равно id', async () => {
    const repo = await single({ dirName: 'other' });
    expect(await run(repo)).toEqual([
      "error other CHECK-002 id: directory name 'other' does not match manifest id 'acme.night'",
    ]);
    await renameDir(repo, 'other', ID);
    expect(await run(repo)).toEqual([]);
  });

  it('CHECK-003: name, description, author обязательны', async () => {
    for (const key of ['name', 'description', 'author']) {
      const hit = await expectRule(
        { manifest: { [key]: undefined } },
        'CHECK-003',
      );
      expect(hit).toContain(`${key}:`);
    }
    await expectRule({ manifest: { name: 'x'.repeat(81) } }, 'CHECK-003');
  });

  it('CHECK-004: README.md обязателен и не пуст', async () => {
    await expectRule({ files: { 'README.md': null } }, 'CHECK-004');
    await expectRule({ files: { 'README.md': '  \n' } }, 'CHECK-004');
  });

  it('CHECK-005: author должен быть логином GitHub', async () => {
    const hit = await expectRule(
      { manifest: { author: '-bad_login' } },
      'CHECK-005',
    );
    expect(hit).toContain('author:');
  });

  it('CHECK-006: автор существует на GitHub; сбой сети — предупреждение', async () => {
    const repo = await single();
    const check = (status: 'exists' | 'missing' | 'unknown') =>
      run(repo, {
        skipGithubCheck: false,
        checkGithubUser: () => Promise.resolve(status),
      });
    expect(await check('exists')).toEqual([]);
    expect(await check('missing')).toEqual([
      "error acme.night CHECK-006 author: GitHub user 'octo-cat' does not exist",
    ]);
    expect(await check('unknown')).toEqual([
      "warning acme.night CHECK-006 author: could not verify GitHub user 'octo-cat'",
    ]);
  });

  it('CHECK-006: --skip-github-check не обращается к GitHub', async () => {
    const checkGithubUser = vi.fn();
    await run(await single(), { checkGithubUser });
    expect(checkGithubUser).not.toHaveBeenCalled();
  });

  it('CHECK-007: package.json обязателен и должен разбираться', async () => {
    await expectRule({ files: { 'package.json': null } }, 'CHECK-007');
    await expectRule({ files: { 'package.json': '{oops' } }, 'CHECK-007');
    await expectRule({ files: { 'package.json': '[]' } }, 'CHECK-007');
  });

  it.each(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock'])(
    'CHECK-008: lock-файл %s принимается, без него — ошибка',
    async (lockfile) => {
      const files = { 'package-lock.json': null, [lockfile]: '{}' };
      expect(await run(await single({ files }))).toEqual([]);
      await expectRule({ files: { 'package-lock.json': null } }, 'CHECK-008');
    },
  );

  it.each([
    'preinstall',
    'install',
    'postinstall',
    'prepare',
    'prepublish',
    'prepublishOnly',
    'prepack',
    'postpack',
  ])('CHECK-009: скрипт %s запрещён, build разрешён', async (script) => {
    const allowed = JSON.stringify({ scripts: { build: 'dolphy-ext build' } });
    expect(
      await run(await single({ files: { 'package.json': allowed } })),
    ).toEqual([]);
    const bad = JSON.stringify({ scripts: { [script]: 'node x.js' } });
    const hit = await expectRule(
      { files: { 'package.json': bad } },
      'CHECK-009',
    );
    expect(hit).toContain(`scripts.${script}:`);
  });

  it.each([
    'git+https://github.com/a/b.git',
    'github:a/b',
    'a/b',
    'https://example.com/x.tgz',
    'http://example.com/x.tgz',
    'file:../x',
    'link:../x',
    'workspace:*',
    '../x',
  ])('CHECK-010: зависимость %s не из реестра', async (specifier) => {
    const manifest = JSON.stringify({ devDependencies: { dep: specifier } });
    const hit = await expectRule(
      { files: { 'package.json': manifest } },
      'CHECK-010',
    );
    expect(hit).toContain('devDependencies.dep:');
  });

  it('CHECK-010: диапазоны реестра и npm-алиасы допустимы', async () => {
    const manifest = JSON.stringify({
      dependencies: {
        a: '^1.2.3',
        b: '~2.0.0',
        c: '*',
        d: 'npm:e@1.0.0',
        f: '1.x',
      },
      peerDependencies: { g: '>=1 <3' },
    });
    expect(
      await run(await single({ files: { 'package.json': manifest } })),
    ).toEqual([]);
  });

  it('CHECK-011: чужой scope пакета — предупреждение, свой и без scope — нет', async () => {
    await expectRule(
      { files: { 'package.json': '{"name":"@acme/x"}' } },
      'CHECK-011',
      'warning',
    );
    for (const name of ['@dolphy-app/x', 'plain']) {
      const files = { 'package.json': JSON.stringify({ name }) };
      expect(await run(await single({ files }))).toEqual([]);
    }
  });

  it('CHECK-012: версия строго больше опубликованной', async () => {
    const repo = await single({ manifest: { version: '1.2.0' } });
    const check = async (versions: string[]) =>
      run(repo, { publishedIndex: await writePublished(repo, ID, versions) });
    expect(await check(['1.1.0', '1.0.0'])).toEqual([]);
    expect(await check(['1.2.0', '1.0.0'])).toEqual([
      'error acme.night CHECK-012 version: version 1.2.0 is already published',
    ]);
    expect(await check(['1.3.0'])).toEqual([
      'error acme.night CHECK-012 version: version 1.2.0 is not greater than published 1.3.0',
    ]);
  });

  it('CHECK-012: версия из середины опубликованных — «уже опубликована»', async () => {
    const repo = await single({ manifest: { version: '1.0.0' } });
    const file = await writePublished(repo, ID, ['2.0.0', '1.0.0']);
    const lines = await run(repo, { publishedIndex: file });
    expect(lines).toEqual([
      'error acme.night CHECK-012 version: version 1.0.0 is already published',
    ]);
  });

  it('CHECK-012: нет файла индекса — ничего не опубликовано; чужой id не мешает', async () => {
    const repo = await single();
    const missing = path.join(repo.root, 'none.json');
    expect(await run(repo, { publishedIndex: missing })).toEqual([]);
    const other = await writePublished(repo, 'acme.other', ['9.0.0']);
    expect(await run(repo, { publishedIndex: other })).toEqual([]);
  });

  it('CHECK-012: битый индекс — ошибка, а не молчаливый пропуск', async () => {
    const repo = await single();
    const file = path.join(repo.root, 'broken.json');
    await writeFile(file, '{"schemaVersion":2}');
    await expect(run(repo, { publishedIndex: file })).rejects.toThrow(
      /not a valid catalog index/,
    );
  });

  it('CHECK-013: лимиты количества и размера исходников', async () => {
    const many = Object.fromEntries(
      Array.from({ length: 201 }, (_, i) => [`src/f${i}.txt`, 'x']),
    );
    await expectRule({ files: many }, 'CHECK-013');
    const big = 'x'.repeat(1_000_001);
    const hit = await expectRule(
      { files: { 'src/big.txt': big } },
      'CHECK-013',
    );
    expect(hit).toContain('src/big.txt:');
    const chunk = 'x'.repeat(900_000);
    const total = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [`src/c${i}.txt`, chunk]),
    );
    const sizeHit = await expectRule({ files: total }, 'CHECK-013');
    expect(sizeHit).toContain('exceed the limit of 5000000');
  });

  it('CHECK-013: node_modules, dist-ext, .dolphy и .git не учитываются', async () => {
    const big = 'x'.repeat(1_000_001);
    const files = {
      'node_modules/dep/index.js': big,
      'dist-ext/main.mjs': big,
      '.dolphy/ids.d.ts': big,
      '.git/objects/blob': big,
    };
    expect(await run(await single({ files }))).toEqual([]);
  });

  it('CHECK-014: символические ссылки запрещены', async () => {
    const repo = await single();
    await symlink('README.md', path.join(repo.dirOf(ID), 'link.md'));
    expect(await run(repo)).toEqual([
      'error acme.night CHECK-014 link.md: symbolic links are not allowed',
    ]);
  });

  it.each(['.exe', '.dll', '.so', '.dylib', '.node', '.sh', '.BAT'])(
    'CHECK-015: файл %s запрещён',
    async (extension) => {
      const hit = await expectRule(
        { files: { [`bin/tool${extension}`]: 'x' } },
        'CHECK-015',
      );
      expect(hit).toContain(`bin/tool${extension}:`);
    },
  );

  it('CHECK-016: minAppVersion не новее --max-app-version', async () => {
    const spec = { manifest: { minAppVersion: '1.3.0' } };
    await expectRule(spec, 'CHECK-016', 'error', { maxAppVersion: '1.2.9' });
    const repo = await single(spec);
    expect(await run(repo, { maxAppVersion: '1.3.0' })).toEqual([]);
    expect(await run(repo)).toEqual([]);
  });
});

describe('catalog check: выбор каталогов', () => {
  it('проверяет все подкаталоги, кроме скрытых и файлов; --ids сужает выбор', async () => {
    const repo = await createRepo([
      { fixture: 'theme-only' },
      { fixture: 'markdown-only', files: { 'README.md': null } },
    ]);
    await mkdir(path.join(repo.extensionsDir, '.github'));
    await writeFile(path.join(repo.extensionsDir, 'notes.txt'), 'x');
    expect(await run(repo)).toEqual([
      'error acme.chart CHECK-004 README.md: README.md is missing or empty',
    ]);
    expect(await run(repo, { ids: [ID] })).toEqual([]);
  });

  it('несуществующий id в --ids и отсутствующий каталог — ошибка использования', async () => {
    const repo = await single();
    await expect(run(repo, { ids: ['nope'] })).rejects.toBeInstanceOf(
      CatalogUsageError,
    );
    await expect(
      run(repo, { extensionsDir: path.join(repo.root, 'absent') }),
    ).rejects.toBeInstanceOf(CatalogUsageError);
  });

  it('каталог без extension.json — CHECK-001 по имени каталога', async () => {
    const repo = await createRepo();
    await mkdir(path.join(repo.extensionsDir, 'empty.dir'));
    const lines = await run(repo);
    expect(
      lines[0]?.startsWith('error empty.dir CHECK-001 extension.json: '),
    ).toBe(true);
  });

  it('после повышения версии замечание CHECK-012 исчезает', async () => {
    const repo = await single();
    const file = await writePublished(repo, ID, ['1.0.0']);
    expect(await run(repo, { publishedIndex: file })).toHaveLength(1);
    await setVersion(repo, ID, '1.0.1');
    expect(await run(repo, { publishedIndex: file })).toEqual([]);
  });
});

describe('GitHub-проверка автора', () => {
  const respond = (status: number) =>
    vi.fn(() => Promise.resolve(new Response('{}', { status })));

  it('200 — есть, 404 — нет, остальное и сбой сети — неизвестно', async () => {
    const statuses = { exists: 200, missing: 404, unknown: 403 } as const;
    for (const [expected, status] of Object.entries(statuses)) {
      const check = createGithubChecker({ fetch: respond(status) });
      expect(await check('octo-cat')).toBe(expected);
    }
    const failing = createGithubChecker({
      fetch: () => Promise.reject(new Error('offline')),
    });
    expect(await failing('octo-cat')).toBe('unknown');
  });

  it('запрашивает users/<login> с токеном и кэширует ответ', async () => {
    const fetcher = respond(200);
    const check = createGithubChecker({ fetch: fetcher, token: 'secret' });
    await check('octo-cat');
    await check('octo-cat');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe('https://api.github.com/users/octo-cat');
    expect(init.headers.authorization).toBe('Bearer secret');
  });
});
