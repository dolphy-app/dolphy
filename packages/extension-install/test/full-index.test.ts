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

describe('the full index', () => {
  it('is read from index.v2.json next to the catalog address, index.json is not requested', async () => {
    serveIndex(env.routes, [ECHO, ICONIC], { full: true });
    serveIndex(env.routes, [{ id: 'acme.old', version: '1.0.0' }]);
    const catalog = await env.installer.catalog();
    expect(catalog.entries.map((entry) => entry.id)).toEqual([
      'acme.echo',
      'acme.iconic',
    ]);
    expect(env.fake.calls.map((call) => call.url)).toEqual([FULL_INDEX_URL]);
  });

  it('falls back to index.json when index.v2.json answers 404', async () => {
    serveIndex(env.routes, [ECHO]);
    const catalog = await env.installer.catalog();
    expect(catalog.entries.map((entry) => entry.id)).toEqual(['acme.echo']);
    expect(env.fake.calls.map((call) => call.url)).toEqual([
      FULL_INDEX_URL,
      CATALOG_URL,
    ]);
  });

  it('does not fall back on other failures of index.v2.json', async () => {
    serveIndex(env.routes, [ECHO]);
    env.routes.set(FULL_INDEX_URL, { fail: true });
    expect(await rejection(env.installer.catalog())).toMatchObject({
      cause: 'catalog-unavailable',
    });
    expect(callsTo(env.fake.calls, CATALOG_URL)).toEqual([]);
  });

  it('keeps the catalog identity: the install record names index.json and updates follow it', async () => {
    serveIndex(env.routes, [ECHO], { full: true });
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
      full: true,
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

  it('keeps ETag and cache per file: the kind is stored in meta, a restart reuses it', async () => {
    serveIndex(env.routes, [ECHO], { full: true, etag: '"full-1"' });
    await env.installer.catalog();
    const meta = JSON.parse(
      await readFile(path.join(env.dir, '.catalog', 'meta.json'), 'utf8'),
    ) as { kind: string; url: string };
    expect(meta).toMatchObject({ kind: 'full', url: CATALOG_URL });
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

  it('does not send the ETag of one file to the other', async () => {
    serveIndex(env.routes, [ECHO], { etag: '"legacy-1"' });
    await env.installer.catalog();
    serveIndex(env.routes, [ECHO], { full: true, etag: '"full-1"' });
    env.clock.advance(11 * 60_000);
    await env.installer.catalog();
    expect(
      callsTo(env.fake.calls, FULL_INDEX_URL).at(-1)?.headers,
    ).not.toHaveProperty('If-None-Match');
    env.routes.delete(FULL_INDEX_URL);
    env.clock.advance(11 * 60_000);
    await env.installer.catalog();
    expect(
      callsTo(env.fake.calls, CATALOG_URL).at(-1)?.headers['If-None-Match'],
    ).toBe(undefined);
  });

  it('guards against a rollback across both files', async () => {
    serveIndex(env.routes, [ECHO], {
      full: true,
      generatedAt: '2026-10-05T00:00:00Z',
    });
    await env.installer.catalog();
    serveIndex(env.routes, [ECHO], {
      full: true,
      generatedAt: '2026-10-04T00:00:00Z',
    });
    env.clock.advance(11 * 60_000);
    const stale = await env.installer.catalog();
    expect(stale.stale).toBe(true);
    expect(stale.error).toMatch(/older than the cached/);
    // index.v2.json disappears and an old index.json is served instead
    env.routes.delete(FULL_INDEX_URL);
    serveIndex(env.routes, [ECHO], { generatedAt: '2026-10-01T00:00:00Z' });
    env.clock.advance(11 * 60_000);
    const downgraded = await env.installer.catalog();
    expect(downgraded.stale).toBe(true);
    expect(downgraded.error).toMatch(/older than the cached/);
  });

  it('accepts the dual-written pair: index.json with the same generatedAt after index.v2.json', async () => {
    serveIndex(env.routes, [ECHO], {
      full: true,
      generatedAt: '2026-10-05T00:00:00Z',
    });
    await env.installer.catalog();
    env.routes.delete(FULL_INDEX_URL);
    serveIndex(env.routes, [ECHO], { generatedAt: '2026-10-05T00:00:00Z' });
    env.clock.advance(11 * 60_000);
    expect((await env.installer.catalog()).stale).toBe(false);
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

  it('reads an index.json the new strict schema would not (unknown contribution keys)', async () => {
    const entry = rawEntry(ECHO) as { contributes: Record<string, unknown> };
    entry.contributes.widgets = ['x'];
    env.routes.set(CATALOG_URL, {
      body: JSON.stringify({
        schemaVersion: 1,
        generatedAt: '2026-10-01T12:00:00Z',
        extensions: [entry],
        revoked: [],
      }),
    });
    expect((await env.installer.catalog()).entries).toHaveLength(1);
  });
});

describe('icon and assets', () => {
  it('shows the icon of the displayed version in the catalog entry', async () => {
    serveIndex(env.routes, [ICONIC, ECHO], { full: true });
    const catalog = await env.installer.catalog();
    const byId = Object.fromEntries(
      catalog.entries.map((entry) => [entry.id, entry]),
    );
    expect(byId['acme.iconic']?.icon).toBe(iconDataUri(ICON_PATH, png(64)));
    expect(byId['acme.echo']?.icon).toBeNull();
  });

  it('installs a version with an icon, a style sheet and an image, byte for byte', async () => {
    serveIndex(env.routes, [ICONIC], { full: true });
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
    serveIndex(env.routes, [ICONIC], { full: true });
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

describe('titles and tags', () => {
  const THEMED: ExtensionSpec = {
    id: 'acme.themed',
    version: '1.0.0',
    contributes: {
      exerciseTypes: [],
      themes: ['acme.themed.dark'],
      markdownRenderers: [],
      gradePolicies: [],
    },
    titles: { themes: { 'acme.themed.dark': 'Dark' } },
    tags: { '1.0.0': ['theme', 'interface'] },
  };

  it('copies the titles of the entry and the tags of the displayed version', async () => {
    serveIndex(env.routes, [THEMED, ECHO], { full: true });
    const { entries } = await env.installer.catalog();
    const byId = Object.fromEntries(entries.map((entry) => [entry.id, entry]));
    expect(byId['acme.themed']).toMatchObject({
      titles: { themes: { 'acme.themed.dark': 'Dark' } },
      tags: ['theme', 'interface'],
    });
    expect(byId['acme.echo']).toMatchObject({ titles: {}, tags: [] });
  });

  it('shows the tags of the newest version, not of an older one', async () => {
    const spec: ExtensionSpec = {
      ...THEMED,
      versions: ['2.0.0', '1.0.0'],
      tags: { '2.0.0': ['developer'], '1.0.0': ['theme'] },
    };
    serveIndex(env.routes, [spec], { full: true });
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
    serveIndex(env.routes, [spec], { full: true });
    const [entry] = (await env.installer.catalog()).entries;
    expect(entry?.incompatible?.fallback?.version).toBe('1.0.0');
    expect(entry?.tags).toEqual(['developer']);
  });

  it('installs a version whose manifest tags match the record in any order', async () => {
    const spec: ExtensionSpec = {
      ...THEMED,
      manifest: { tags: ['interface', 'theme'] },
    };
    serveIndex(env.routes, [spec], { full: true });
    serve(env.routes, spec);
    await expect(env.installer.install('acme.themed')).resolves.toMatchObject({
      version: '1.0.0',
    });
  });

  it('refuses a manifest whose tags differ from the index record', async () => {
    const spec: ExtensionSpec = { ...THEMED, manifest: { tags: ['theme'] } };
    serveIndex(env.routes, [spec], { full: true });
    serve(env.routes, spec);
    expect(await rejection(env.installer.install('acme.themed'))).toMatchObject(
      { cause: 'invalid' },
    );
  });
});
