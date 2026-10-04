import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExtensionInstallError } from '@dolphy-app/engine/ports';
import {
  CATALOG_URL,
  FULL_INDEX_URL,
  callsTo,
  contributesOf,
  createEnv,
  installFake,
  rawIndex,
  serveIndex,
} from './helpers.ts';
import type { Env } from './helpers.ts';

let env: Env;
beforeEach(async () => {
  env = await createEnv();
});
afterEach(() => env.cleanup());

const errorOf = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );

describe('catalog: статусы записей', () => {
  it('отдаёт записи по названию без учёта регистра и считает статусы', async () => {
    serveIndex(env.routes, [
      { id: 'zeta.new', name: 'zeta', version: '1.0.0' },
      { id: 'beta.kept', name: 'Beta', version: '1.0.0' },
      {
        id: 'alpha.upd',
        name: 'alpha',
        version: '1.1.0',
        versions: ['1.1.0', '1.0.0'],
      },
      {
        id: 'delta.app',
        name: 'Delta',
        version: '2.0.0',
        versions: ['2.0.0', '1.0.0'],
        minAppVersion: '9.0.0',
      },
    ]);
    await installFake(env.dir, 'beta.kept', '1.0.0');
    await installFake(env.dir, 'alpha.upd', '1.0.0');
    const catalog = await env.installer.catalog();
    expect(catalog.entries.map((e) => [e.name, e.status])).toEqual([
      ['alpha', 'update'],
      ['Beta', 'installed'],
      ['Delta', 'incompatible'],
      ['zeta', 'available'],
    ]);
    const byId = Object.fromEntries(catalog.entries.map((e) => [e.id, e]));
    expect(byId['alpha.upd']).toMatchObject({
      installedVersion: '1.0.0',
      latest: { version: '1.1.0', permissions: [] },
    });
    expect(byId['zeta.new']?.installedVersion).toBeNull();
    expect(catalog).toMatchObject({ stale: false, error: null });
    expect(catalog.fetchedAt).toBe(new Date(env.clock.now()).toISOString());
  });

  it('несовместимое по minAppVersion: причина и старая версия как запасная', async () => {
    env = await createEnv({ appVersion: '1.0.0' });
    serveIndex(env.routes, [
      {
        id: 'delta.app',
        version: '2.0.0',
        versions: ['2.0.0', '1.0.0'],
        minAppVersion: '9.0.0',
      },
    ]);
    const [entry] = (await env.installer.catalog()).entries;
    expect(entry).toMatchObject({
      status: 'incompatible',
      latest: null,
      incompatible: {
        reason: 'app',
        detail: 'requires app >= 9.0.0',
        fallback: null,
      },
    });
  });

  it('запись для чужой платформы остаётся с причиной platform', async () => {
    serveIndex(env.routes, [
      { id: 'win.only', version: '1.0.0', platforms: ['win32'] },
    ]);
    const [entry] = (await env.installer.catalog()).entries;
    expect(entry).toMatchObject({
      status: 'incompatible',
      incompatible: { reason: 'platform', detail: 'not available on darwin' },
    });
  });

  it('отозванная новейшая версия не предлагается: запасная — прежняя', async () => {
    serveIndex(
      env.routes,
      [{ id: 'acme.rev', version: '1.1.0', versions: ['1.1.0', '1.0.0'] }],
      { revoked: [{ id: 'acme.rev', versions: '>=1.1.0', reason: 'leak' }] },
    );
    const [entry] = (await env.installer.catalog()).entries;
    expect(entry).toMatchObject({
      status: 'incompatible',
      incompatible: {
        reason: 'revoked',
        detail: 'leak',
        fallback: { version: '1.0.0' },
      },
    });
  });

  it('установка из другого каталога не считается установленной', async () => {
    serveIndex(env.routes, [{ id: 'acme.echo', version: '1.0.0' }]);
    await installFake(
      env.dir,
      'acme.echo',
      '1.0.0',
      'https://other.test/index.json',
    );
    const [entry] = (await env.installer.catalog()).entries;
    expect(entry).toMatchObject({
      status: 'available',
      installedVersion: null,
    });
  });

  it('size — сумма размеров файлов версии', async () => {
    serveIndex(env.routes, [
      { id: 'acme.echo', version: '1.0.0', main: 'xxxx' },
    ]);
    const [entry] = (await env.installer.catalog()).entries;
    const manifestSize = Buffer.byteLength(
      JSON.stringify({
        id: 'acme.echo',
        version: '1.0.0',
        permissions: [],
        contributes: contributesOf(['acme.echo']),
      }),
    );
    expect(entry?.latest?.size).toBe(manifestSize + 4);
  });
});

describe('catalog: сводка вклада в DTO', () => {
  it('commands и panels копируются в contributes, по умолчанию []', async () => {
    serveIndex(env.routes, [
      {
        id: 'acme.cmds',
        version: '1.0.0',
        contributes: {
          ...contributesOf([]),
          commands: ['acme.cmds.open'],
          panels: ['acme.cmds.main'],
        },
      },
      { id: 'acme.plain', version: '1.0.0' },
    ]);
    const { entries } = await env.installer.catalog();
    const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
    expect(byId['acme.cmds']?.contributes).toMatchObject({
      commands: ['acme.cmds.open'],
      panels: ['acme.cmds.main'],
    });
    expect(byId['acme.plain']?.contributes).toMatchObject({
      commands: [],
      panels: [],
    });
  });
});

describe('catalog: кэш и сеть', () => {
  it('свежий кэш не ходит в сеть, refresh ходит', async () => {
    serveIndex(env.routes, [{ id: 'acme.echo', version: '1.0.0' }]);
    await env.installer.catalog();
    await env.installer.catalog();
    expect(callsTo(env.fake.calls, FULL_INDEX_URL)).toHaveLength(1);
    await env.installer.catalog({ refresh: true });
    expect(callsTo(env.fake.calls, FULL_INDEX_URL)).toHaveLength(2);
  });

  it('запрос идёт с User-Agent версии приложения', async () => {
    serveIndex(env.routes, [{ id: 'acme.echo', version: '1.0.0' }]);
    await env.installer.catalog();
    expect(env.fake.calls[0]?.headers['User-Agent']).toBe('dolphy/1.0.0');
    const dev = await createEnv({ appVersion: undefined });
    serveIndex(dev.routes, []);
    await dev.installer.catalog();
    expect(dev.fake.calls[0]?.headers['User-Agent']).toBe('dolphy/dev');
    await dev.cleanup();
  });

  it('устаревший кэш проверяется по ETag: 304 продлевает кэш', async () => {
    serveIndex(env.routes, [{ id: 'acme.echo', version: '1.0.0' }], {
      etag: '"v1"',
    });
    const first = await env.installer.catalog();
    env.clock.advance(11 * 60_000);
    const second = await env.installer.catalog();
    expect(
      callsTo(env.fake.calls, FULL_INDEX_URL)[1]?.headers['If-None-Match'],
    ).toBe('"v1"');
    expect(second.entries).toEqual(first.entries);
    expect(second).toMatchObject({ stale: false, error: null });
    expect(second.fetchedAt).toBe(new Date(env.clock.now()).toISOString());
    const meta = JSON.parse(
      await readFile(path.join(env.dir, '.catalog', 'meta.json'), 'utf8'),
    ) as { etag: string; fetchedAt: string; url: string };
    expect(meta).toEqual({
      etag: '"v1"',
      fetchedAt: new Date(env.clock.now()).toISOString(),
      url: CATALOG_URL,
    });
  });

  it('нет сети: последний кэш со stale и причиной', async () => {
    serveIndex(env.routes, [{ id: 'acme.echo', version: '1.0.0' }]);
    await env.installer.catalog();
    env.routes.set(FULL_INDEX_URL, { fail: true });
    const catalog = await env.installer.catalog({ refresh: true });
    expect(catalog.entries).toHaveLength(1);
    expect(catalog.stale).toBe(true);
    expect(catalog.error).toContain('fetch failed');
    expect(env.logger.warn).toHaveBeenCalled();
  });

  it('после перезапуска кэш читается с диска и работает офлайн', async () => {
    serveIndex(env.routes, [{ id: 'acme.echo', version: '1.0.0' }]);
    await env.installer.catalog();
    env.routes.set(FULL_INDEX_URL, { fail: true });
    env.clock.advance(60 * 60_000);
    const restarted = env.restart();
    await restarted.ready();
    expect(await restarted.updates()).toEqual([]);
    const catalog = await restarted.catalog();
    expect(catalog.entries.map((e) => e.id)).toEqual(['acme.echo']);
    expect(catalog.stale).toBe(true);
  });

  it.each([
    ['HTTP 500', { status: 500, body: 'oops' }, 'HTTP 500'],
    ['не JSON', { body: '<html>' }, 'not valid JSON'],
    ['индекс не по схеме', { body: '{"schemaVersion":3}' }, 'invalid catalog'],
  ])('%s: кэш остаётся, причина в error', async (_name, route, fragment) => {
    serveIndex(env.routes, [{ id: 'acme.echo', version: '1.0.0' }]);
    await env.installer.catalog();
    env.routes.set(FULL_INDEX_URL, route);
    const catalog = await env.installer.catalog({ refresh: true });
    expect(catalog.stale).toBe(true);
    expect(catalog.error).toContain(fragment);
    expect(catalog.entries).toHaveLength(1);
  });

  it('более старый индекс не заменяет кэш (откат индекса)', async () => {
    serveIndex(env.routes, [{ id: 'acme.echo', version: '1.0.0' }], {
      generatedAt: '2026-10-02T00:00:00Z',
    });
    await env.installer.catalog();
    serveIndex(env.routes, [], { generatedAt: '2026-10-01T00:00:00Z' });
    const catalog = await env.installer.catalog({ refresh: true });
    expect(catalog.stale).toBe(true);
    expect(catalog.error).toContain('older');
    expect(catalog.entries).toHaveLength(1);
  });

  it('повреждённый кэш игнорируется с предупреждением', async () => {
    await mkdir(path.join(env.dir, '.catalog'), { recursive: true });
    await writeFile(path.join(env.dir, '.catalog', 'index.v2.json'), '{broken');
    await writeFile(
      path.join(env.dir, '.catalog', 'meta.json'),
      JSON.stringify({
        etag: null,
        fetchedAt: new Date().toISOString(),
        url: CATALOG_URL,
      }),
    );
    serveIndex(env.routes, [{ id: 'acme.echo', version: '1.0.0' }]);
    await env.installer.ready();
    expect(env.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
      expect.stringContaining('catalog cache ignored'),
    );
    expect((await env.installer.catalog()).entries).toHaveLength(1);
    expect(callsTo(env.fake.calls, FULL_INDEX_URL)).toHaveLength(1);
  });

  it('кэш другого адреса каталога не используется', async () => {
    serveIndex(env.routes, [{ id: 'acme.echo', version: '1.0.0' }]);
    await env.installer.catalog();
    env.routes.set(FULL_INDEX_URL, { fail: true });
    const other = env.restart({ catalogUrl: 'https://other.test/index.json' });
    const error = await errorOf(other.catalog());
    expect(error).toBeInstanceOf(ExtensionInstallError);
    expect((error as ExtensionInstallError).cause).toBe('catalog-unavailable');
  });

  it('нет кэша и нет сети: catalog-unavailable', async () => {
    env.routes.set(FULL_INDEX_URL, { fail: true });
    const error = await errorOf(env.installer.catalog());
    expect(error).toMatchObject({
      name: 'ExtensionInstallError',
      cause: 'catalog-unavailable',
      extensionId: null,
    });
  });

  it('индекс не по схеме без кэша: catalog-unavailable', async () => {
    env.routes.set(FULL_INDEX_URL, {
      body: rawIndex([]).replace('"schemaVersion":2', '"schemaVersion":7'),
    });
    const error = await errorOf(env.installer.catalog());
    expect(error).toMatchObject({ cause: 'catalog-unavailable' });
  });

  it('запросы только на origin каталога: редирект на чужой origin отклонён', async () => {
    env.routes.set(FULL_INDEX_URL, {
      status: 302,
      headers: { location: 'https://evil.test/index.json' },
    });
    const error = await errorOf(env.installer.catalog());
    expect(error).toMatchObject({ cause: 'catalog-unavailable' });
    expect(env.fake.calls.map((c) => c.url)).toEqual([FULL_INDEX_URL]);
  });

  it('checkForUpdates не бросает при сбое сети и возвращает число обновлений', async () => {
    serveIndex(env.routes, [
      { id: 'acme.echo', version: '1.1.0', versions: ['1.1.0', '1.0.0'] },
    ]);
    await installFake(env.dir, 'acme.echo', '1.0.0');
    expect(await env.installer.checkForUpdates()).toBe(1);
    env.routes.set(FULL_INDEX_URL, { fail: true });
    expect(await env.installer.checkForUpdates()).toBe(1);
    const cold = await createEnv();
    cold.routes.set(FULL_INDEX_URL, { fail: true });
    expect(await cold.installer.checkForUpdates()).toBe(0);
    expect(cold.logger.warn).toHaveBeenCalled();
    await cold.cleanup();
  });
});
