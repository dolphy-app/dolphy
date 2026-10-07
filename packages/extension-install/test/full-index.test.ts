import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { iconDataUri } from '@dolphy-app/extension-catalog';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { png } from '../../extension-catalog/test/samples.ts';
import {
  CATALOG_URL,
  FULL_INDEX_URL,
  ICON_PATH,
  callsTo,
  createEnv,
  filesOf,
  rawEntry,
  serve,
  serveIndex,
} from './helpers.ts';
import type { Env, ExtensionSpec } from './helpers.ts';

let env: Env;
beforeEach(async () => {
  env = await createEnv();
});
afterEach(() => env.cleanup());

const rejection = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );

const ECHO: ExtensionSpec = { id: 'acme.echo', version: '1.0.0' };
const ICONIC: ExtensionSpec = {
  id: 'acme.iconic',
  version: '1.0.0',
  icon: png(64),
  extraFiles: {
    'assets/panel.css': '.a{color:red}',
    'assets/logo.png': png(100),
  },
};

describe('the index', () => {
  it('is read from index.v2.json next to the catalog address, nothing else is requested', async () => {
    serveIndex(env.routes, [ECHO, ICONIC]);
    const catalog = await env.installer.catalog();
    expect(catalog.entries.map((entry) => entry.id)).toEqual([
      'acme.echo',
      'acme.iconic',
    ]);
    expect(env.fake.calls.map((call) => call.url)).toEqual([FULL_INDEX_URL]);
  });

  it('a 404 of index.v2.json makes the catalog unavailable and does not fall back to index.json', async () => {
    env.routes.set(CATALOG_URL, {
      body: JSON.stringify({ schemaVersion: 1 }),
    });
    expect(await rejection(env.installer.catalog())).toMatchObject({
      cause: 'catalog-unavailable',
    });
    expect(env.fake.calls.map((call) => call.url)).toEqual([FULL_INDEX_URL]);
  });

  it('serves the cache with the reason when index.v2.json disappears', async () => {
    serveIndex(env.routes, [ECHO]);
    await env.installer.catalog();
    env.routes.delete(FULL_INDEX_URL);
    env.clock.advance(11 * 60_000);
    const stale = await env.installer.catalog();
    expect(stale.stale).toBe(true);
    expect(stale.error).toContain('404');
    expect(stale.entries.map((entry) => entry.id)).toEqual(['acme.echo']);
  });

  it('keeps the catalog identity: the install record names the catalog address and updates follow it', async () => {
    serveIndex(env.routes, [ECHO]);
    serve(env.routes, ECHO);
    await env.installer.install('acme.echo');
    const meta = JSON.parse(
      await readFile(
        path.join(env.dir, 'acme.echo', '.dolphy-install.json'),
        'utf8',
      ),
    ) as { catalogUrl: string };
    expect(meta.catalogUrl).toBe(CATALOG_URL);
    const next: ExtensionSpec = {
      ...ECHO,
      version: '1.1.0',
      versions: ['1.1.0', '1.0.0'],
    };
    serveIndex(env.routes, [next], {
      generatedAt: '2026-10-02T00:00:00Z',
    });
    env.clock.advance(11 * 60_000);
    const fresh = env.restart();
    expect(await fresh.checkForUpdates()).toBe(1);
    expect((await fresh.updates())[0]).toMatchObject({
      id: 'acme.echo',
      installed: '1.0.0',
      available: { version: '1.1.0' },
    });
  });

  it('keeps the ETag and the cache across a restart', async () => {
    serveIndex(env.routes, [ECHO], { etag: '"full-1"' });
    await env.installer.catalog();
    const meta = JSON.parse(
      await readFile(path.join(env.dir, '.catalog', 'meta.json'), 'utf8'),
    ) as { url: string };
    expect(meta).toMatchObject({ url: CATALOG_URL });
    env.clock.advance(11 * 60_000);
    await env.installer.catalog();
    expect(
      callsTo(env.fake.calls, FULL_INDEX_URL)[1]?.headers['If-None-Match'],
    ).toBe('"full-1"');
    const restarted = env.restart();
    await restarted.ready();
    env.clock.advance(11 * 60_000);
    await restarted.catalog();
    expect(
      callsTo(env.fake.calls, FULL_INDEX_URL)[2]?.headers['If-None-Match'],
    ).toBe('"full-1"');
  });

  it('guards against a rollback', async () => {
    serveIndex(env.routes, [ECHO], { generatedAt: '2026-10-05T00:00:00Z' });
    await env.installer.catalog();
    serveIndex(env.routes, [ECHO], { generatedAt: '2026-10-04T00:00:00Z' });
    env.clock.advance(11 * 60_000);
    const stale = await env.installer.catalog();
    expect(stale.stale).toBe(true);
    expect(stale.error).toMatch(/older than the cached/);
  });
});

describe('tolerant reading', () => {
  const rawFull = (entries: unknown[], extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      schemaVersion: 2,
      generatedAt: '2026-10-01T12:00:00Z',
      extensions: entries,
      revoked: [],
      ...extra,
    });

  it('skips the entries and versions it cannot read and logs them; unknown keys are dropped', async () => {
    const good = rawEntry(ECHO);
    const futureVersion = {
      ...(
        rawEntry({ ...ECHO, versions: ['2.0.0', '1.0.0'] }).versions as object[]
      )[0],
      files: [
        { path: 'extension.json', size: 1, sha256: 'a'.repeat(64) },
        { path: 'x.gif', size: 1, sha256: 'a'.repeat(64) },
      ],
    };
    const base = rawEntry({ id: 'acme.mixed', version: '1.0.0' });
    const mixed = {
      ...base,
      future: { anything: true },
      versions: [futureVersion, ...(base.versions as object[])],
    };
    env.routes.set(FULL_INDEX_URL, {
      body: rawFull([
        good,
        {
          ...rawEntry({ id: 'acme.broken', version: '1.0.0' }),
          author: 'not a login!',
        },
        mixed,
      ]),
    });
    const catalog = await env.installer.catalog();
    expect(catalog.entries.map((entry) => entry.id)).toEqual([
      'acme.echo',
      'acme.mixed',
    ]);
    expect(catalog.stale).toBe(false);
    expect(env.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        warnings: expect.arrayContaining([
          expect.stringContaining('acme.mixed'),
        ]),
      }),
      expect.stringContaining('skipped'),
    );
  });

  it('an unreadable revocation list rejects the catalog as a whole', async () => {
    env.routes.set(FULL_INDEX_URL, {
      body: rawFull([rawEntry(ECHO)], { revoked: [{ id: 'acme.echo' }] }),
    });
    expect(await rejection(env.installer.catalog())).toMatchObject({
      cause: 'catalog-unavailable',
    });
  });

  it('reads an index the strict schema would not (unknown entry keys)', async () => {
    const entry = { ...rawEntry(ECHO), future: ['x'] };
    env.routes.set(FULL_INDEX_URL, { body: rawFull([entry]) });
    expect((await env.installer.catalog()).entries).toHaveLength(1);
  });

  it('rejects an index of the first format (schemaVersion 1)', async () => {
    env.routes.set(FULL_INDEX_URL, {
      body: rawFull([rawEntry(ECHO)], { schemaVersion: 1 }),
    });
    expect(await rejection(env.installer.catalog())).toMatchObject({
      cause: 'catalog-unavailable',
    });
  });
});

describe('icon and assets', () => {
  it('shows the icon of the displayed version in the catalog entry', async () => {
    serveIndex(env.routes, [ICONIC, ECHO]);
    const catalog = await env.installer.catalog();
    const byId = Object.fromEntries(
      catalog.entries.map((entry) => [entry.id, entry]),
    );
    expect(byId['acme.iconic']?.icon).toBe(iconDataUri(ICON_PATH, png(64)));
    expect(byId['acme.echo']?.icon).toBeNull();
  });

  it('installs a version with an icon, a style sheet and an image, byte for byte', async () => {
    serveIndex(env.routes, [ICONIC]);
    serve(env.routes, ICONIC);
    await env.installer.install('acme.iconic');
    const read = (file: string) =>
      readFile(path.join(env.dir, 'acme.iconic', ...file.split('/')));
    expect(new Uint8Array(await read('assets/logo.png'))).toEqual(png(100));
    expect(new Uint8Array(await read(ICON_PATH))).toEqual(png(64));
    expect(await read('assets/panel.css')).toEqual(
      Buffer.from('.a{color:red}'),
    );
  });

  it('refuses a version whose manifest icon differs from the index record', async () => {
    serveIndex(env.routes, [ICONIC]);
    const other = png(80);
    // the files on the server are consistent with their own sha256, but the icon is another one
    for (const file of filesOf({ ...ICONIC, icon: other }, '1.0.0')) {
      env.routes.set(
        `https://catalog.test/extensions/acme.iconic/1.0.0/${file.path}`,
        { body: file.content },
      );
    }
    const index = JSON.parse(
      (env.routes.get(FULL_INDEX_URL)?.body as string) ?? '{}',
    ) as {
      extensions: {
        versions: { files: { path: string; size: number; sha256: string }[] }[];
      }[];
    };
    const record = rawEntry({ ...ICONIC, icon: other }) as {
      versions: { files: { path: string; size: number; sha256: string }[] }[];
    };
    // the index keeps the original icon URI while the files are those of `other`
    index.extensions[0]!.versions[0]!.files = record.versions[0]!.files;
    env.routes.set(FULL_INDEX_URL, { body: JSON.stringify(index) });
    expect(await rejection(env.installer.install('acme.iconic'))).toMatchObject(
      {
        cause: 'invalid',
        message: expect.stringContaining('icon'),
      },
    );
  });

  it('refuses a manifest icon when the index record has none', async () => {
    const entry = rawEntry(ICONIC) as {
      versions: { icon?: string }[];
    };
    delete entry.versions[0]?.icon;
    env.routes.set(FULL_INDEX_URL, {
      body: JSON.stringify({
        schemaVersion: 2,
        generatedAt: '2026-10-01T12:00:00Z',
        extensions: [entry],
        revoked: [],
      }),
    });
    serve(env.routes, ICONIC);
    expect(await rejection(env.installer.install('acme.iconic'))).toMatchObject(
      {
        cause: 'invalid',
        message: expect.stringContaining('icon'),
      },
    );
  });

  it('refuses per-type ceilings and case-insensitive duplicates before downloading', async () => {
    const big = {
      ...ICONIC,
      extraFiles: { 'assets/a.css': 'x'.repeat(10) },
    };
    const entry = rawEntry(big) as {
      versions: { files: { path: string; size: number; sha256: string }[] }[];
    };
    const files = entry.versions[0]!.files;
    files.find((file) => file.path === 'assets/a.css')!.size = 300 * 1024;
    env.routes.set(FULL_INDEX_URL, {
      body: JSON.stringify({
        schemaVersion: 2,
        generatedAt: '2026-10-01T12:00:00Z',
        extensions: [entry],
        revoked: [],
      }),
    });
    // the tolerant reader drops the version with the oversized style sheet: nothing is installable
    expect(await rejection(env.installer.install('acme.iconic'))).toMatchObject(
      {
        cause: 'not-found',
      },
    );
    expect(
      env.fake.calls.filter((call) => call.url.includes('/extensions/')),
    ).toEqual([]);
  });
});

describe('tags', () => {
  const THEMED: ExtensionSpec = {
    id: 'acme.themed',
    version: '1.0.0',
    tags: { '1.0.0': ['theme', 'interface'] },
  };

  it('copies the tags of the displayed version', async () => {
    serveIndex(env.routes, [THEMED, ECHO]);
    const { entries } = await env.installer.catalog();
    const byId = Object.fromEntries(entries.map((entry) => [entry.id, entry]));
    expect(byId['acme.themed']).toMatchObject({
      tags: ['theme', 'interface'],
    });
    expect(byId['acme.echo']).toMatchObject({ tags: [] });
  });

  it('shows the tags of the newest version, not of an older one', async () => {
    const spec: ExtensionSpec = {
      ...THEMED,
      versions: ['2.0.0', '1.0.0'],
      tags: { '2.0.0': ['developer'], '1.0.0': ['theme'] },
    };
    serveIndex(env.routes, [spec]);
    const [entry] = (await env.installer.catalog()).entries;
    expect(entry?.latest?.version).toBe('2.0.0');
    expect(entry?.tags).toEqual(['developer']);
  });

  it('shows the tags of the newest version, not of the fallback, when the newest is incompatible', async () => {
    const spec: ExtensionSpec = {
      ...THEMED,
      versions: ['2.0.0', '1.0.0'],
      minAppByVersion: { '2.0.0': '9.0.0' },
      tags: { '2.0.0': ['developer'], '1.0.0': ['theme'] },
    };
    serveIndex(env.routes, [spec]);
    const [entry] = (await env.installer.catalog()).entries;
    expect(entry?.incompatible?.fallback?.version).toBe('1.0.0');
    expect(entry?.tags).toEqual(['developer']);
  });

  it('installs a version whose manifest tags match the record in any order', async () => {
    const spec: ExtensionSpec = {
      ...THEMED,
      manifest: { tags: ['interface', 'theme'] },
    };
    serveIndex(env.routes, [spec]);
    serve(env.routes, spec);
    await expect(env.installer.install('acme.themed')).resolves.toMatchObject({
      version: '1.0.0',
    });
  });

  it('refuses a manifest whose tags differ from the index record', async () => {
    const spec: ExtensionSpec = { ...THEMED, manifest: { tags: ['theme'] } };
    serveIndex(env.routes, [spec]);
    serve(env.routes, spec);
    expect(await rejection(env.installer.install('acme.themed'))).toMatchObject(
      { cause: 'invalid' },
    );
  });
});
