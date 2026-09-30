import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CatalogVersion } from '@spirula-app/extension-catalog';
import { downloadVersion } from '../src/download.ts';
import { nodeFs } from '../src/index.ts';
import { createHttpClient } from '../src/http.ts';
import { CATALOG_URL, createFakeFetch, sha256 } from './helpers.ts';
import type { Route } from './helpers.ts';

/**
 * `downloadVersion` получает версию из разобранного индекса, но повторяет
 * проверки схемы: версия здесь собрана вручную, в обход `parseIndex`.
 */
let dir: string;
let routes: Map<string, Route>;
let calls: ReturnType<typeof createFakeFetch>['calls'];
let httpClient: ReturnType<typeof createHttpClient>;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'spirula-download-'));
  routes = new Map();
  const fake = createFakeFetch(routes);
  calls = fake.calls;
  httpClient = createHttpClient({
    fetch: fake.fetch,
    origin: new URL(CATALOG_URL).origin,
    userAgent: 'spirula/test',
    timeoutMs: 1000,
  });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const file = (filePath: string, content = 'x', size = content.length) => ({
  path: filePath,
  size,
  sha256: sha256(content),
});

const versionWith = (
  files: CatalogVersion['files'],
  baseUrl = 'extensions/x/1.0.0/',
): CatalogVersion => ({
  version: '1.0.0',
  apiVersion: 1,
  minAppVersion: null,
  permissions: [],
  publishedAt: '2026-10-01T00:00:00Z',
  baseUrl,
  files,
});

const run = (version: CatalogVersion): Promise<void> =>
  downloadVersion({
    http: httpClient,
    fs: nodeFs,
    catalogUrl: CATALOG_URL,
    extensionId: 'acme.x',
    version,
    directory: dir,
  });

describe('downloadVersion: защитные проверки плана', () => {
  it.each([
    ['выход из каталога', '../escape.json'],
    ['точка-каталог', '.hidden/a.json'],
    ['обратная косая', 'a\\b.json'],
    ['пустой сегмент', 'a//b.json'],
    ['абсолютный путь', '/etc/passwd.json'],
    ['пустой путь', ''],
  ])('небезопасный путь (%s): invalid, сеть не тронута', async (_name, p) => {
    await expect(run(versionWith([file(p)]))).rejects.toMatchObject({
      cause: 'invalid',
    });
    expect(calls).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  it('повтор пути и файл внутри файла: invalid', async () => {
    await expect(
      run(versionWith([file('a.json'), file('a.json')])),
    ).rejects.toMatchObject({ cause: 'invalid' });
    await expect(
      run(versionWith([file('a'), file('a/b.json')])),
    ).rejects.toMatchObject({ cause: 'invalid' });
    expect(calls).toEqual([]);
  });

  it('больше 50 файлов: limits', async () => {
    const files = Array.from({ length: 51 }, (_, i) => file(`f${i}.json`));
    await expect(run(versionWith(files))).rejects.toMatchObject({
      cause: 'limits',
    });
    expect(calls).toEqual([]);
  });

  it('заявленная сумма больше 10 МБ: limits до первого запроса', async () => {
    const files = [
      file('a.json', 'x', 6_000_000),
      file('b.json', 'x', 6_000_000),
    ];
    await expect(run(versionWith(files))).rejects.toMatchObject({
      cause: 'limits',
    });
    expect(calls).toEqual([]);
  });

  it('baseUrl на чужом origin: network, запрос не отправлен', async () => {
    const version = versionWith([file('a.json')], 'https://evil.test/x/');
    await expect(run(version)).rejects.toMatchObject({ cause: 'network' });
    expect(calls).toEqual([]);
  });

  it('файл пишется по относительному пути во вложенные каталоги', async () => {
    routes.set('https://catalog.test/extensions/x/1.0.0/schema/spec.json', {
      body: 'x',
    });
    await run(versionWith([file('schema/spec.json')]));
    expect(await readdir(path.join(dir, 'schema'))).toEqual(['spec.json']);
  });
});
