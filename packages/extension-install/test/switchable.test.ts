import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createExtensionInstaller,
  createSwitchableInstaller,
} from '../src/index.ts';
import {
  CATALOG_URL,
  callsTo,
  createEnv,
  installFake,
  rawIndex,
  serve,
  serveIndex,
} from './helpers.ts';
import type { Env } from './helpers.ts';

const OTHER_URL = 'https://other.test/index.json';
const OTHER_INDEX_URL = 'https://other.test/index.v2.json';
const NEW_URL = 'https://catalog.test/new/index.json';

let env: Env;
beforeEach(async () => {
  env = await createEnv();
});
afterEach(async () => {
  await env.cleanup();
});

const open = (extra: { envUrl?: string; settingUrl?: string | null } = {}) =>
  createSwitchableInstaller({
    defaultUrl: CATALOG_URL,
    settingUrl: extra.settingUrl ?? null,
    ...(extra.envUrl !== undefined && { envUrl: extra.envUrl }),
    create: (catalogUrl) =>
      createExtensionInstaller({ ...env.options, catalogUrl }),
  });

const metaOf = async (id: string): Promise<{ catalogUrl: string }> =>
  JSON.parse(
    await readFile(path.join(env.dir, id, '.dolphy-install.json'), 'utf8'),
  ) as { catalogUrl: string };

describe('catalogSource', () => {
  it('prefers the environment, then the setting, then the default', () => {
    expect(open().catalogSource()).toEqual({
      url: CATALOG_URL,
      default: CATALOG_URL,
      origin: 'default',
    });
    expect(open({ settingUrl: OTHER_URL }).catalogSource()).toEqual({
      url: OTHER_URL,
      default: CATALOG_URL,
      origin: 'setting',
    });
    expect(
      open({ envUrl: NEW_URL, settingUrl: OTHER_URL }).catalogSource(),
    ).toEqual({ url: NEW_URL, default: CATALOG_URL, origin: 'env' });
  });

  it('a stored address equal to the default counts as the default', () => {
    expect(open({ settingUrl: CATALOG_URL }).catalogSource().origin).toBe(
      'default',
    );
  });

  it('refuses to switch while the environment decides', async () => {
    const installer = open({ envUrl: NEW_URL });
    await expect(installer.useCatalog(OTHER_URL)).rejects.toThrow(
      'environment',
    );
    expect(installer.catalogSource().url).toBe(NEW_URL);
  });
});

describe('two catalogs', () => {
  const OLD = { id: 'acme.old', version: '1.0.0' };

  it('extensions installed from the former catalog keep working, get no updates and none of the new catalog revocations and warnings', async () => {
    serveIndex(env.routes, [OLD]);
    serve(env.routes, OLD);
    const installer = open();
    await installer.ready();
    await installer.install('acme.old');
    const before = await metaOf('acme.old');
    expect(before.catalogUrl).toBe(CATALOG_URL);

    // the other catalog publishes acme.old 2.0.0, revokes it and marks it deprecated
    const spec = {
      id: 'acme.old',
      version: '2.0.0',
      deprecated: { versions: null, reason: 'Gone', alternatives: [] },
    };
    env.routes.set(OTHER_INDEX_URL, {
      body: rawIndex([spec], {
        revoked: [{ id: 'acme.old', versions: '<1.5.0', reason: 'bad build' }],
      }),
    });

    await installer.useCatalog(OTHER_URL);
    expect(installer.catalogSource()).toEqual({
      url: OTHER_URL,
      default: CATALOG_URL,
      origin: 'setting',
    });
    const catalog = await installer.catalog({ refresh: true });
    const entry = catalog.entries.find(({ id }) => id === 'acme.old');
    // «installed from another source»: taken, not installed from this catalog
    expect(entry).toMatchObject({ installedVersion: null, elsewhere: true });
    expect(await installer.updates()).toEqual([]);
    expect(await installer.checkForUpdates()).toBe(0);
    // the installed extension's identity is the former catalog
    expect(installer.revocationOf('acme.old', '1.0.0', CATALOG_URL)).toBeNull();
    expect(
      installer.deprecationOf('acme.old', '1.0.0', CATALOG_URL),
    ).toBeNull();
    // ...while an extension installed from the new catalog would be affected
    expect(installer.revocationOf('acme.old', '1.0.0', OTHER_URL)).toBe(
      'bad build',
    );
    expect(installer.deprecationOf('acme.old', '1.0.0', OTHER_URL)).toEqual({
      versions: null,
      reason: 'Gone',
      alternatives: [],
    });
    await expect(installer.install('acme.old')).rejects.toMatchObject({
      cause: 'conflict',
    });
    expect(await metaOf('acme.old')).toEqual(before);
    // it can still be removed
    await installer.uninstall('acme.old');
  });

  it('going back to the former address brings updates and revocation back', async () => {
    serveIndex(
      env.routes,
      [{ id: 'acme.old', version: '2.0.0', versions: ['2.0.0', '1.0.0'] }],
      {
        revoked: [{ id: 'acme.old', versions: '<1.5.0', reason: 'old build' }],
      },
    );
    await installFake(env.dir, 'acme.old', '1.0.0');
    const installer = open();
    await installer.catalog();
    expect(await installer.updates()).toHaveLength(1);
    expect(installer.revocationOf('acme.old', '1.0.0', CATALOG_URL)).toBe(
      'old build',
    );

    env.routes.set(OTHER_INDEX_URL, { fail: true });
    await installer.useCatalog(OTHER_URL);
    expect(await installer.updates()).toEqual([]);
    expect(installer.revocationOf('acme.old', '1.0.0', CATALOG_URL)).toBeNull();

    await installer.useCatalog(null);
    expect(installer.catalogSource().origin).toBe('default');
    await installer.catalog({ refresh: true });
    expect(await installer.updates()).toHaveLength(1);
    expect(installer.revocationOf('acme.old', '1.0.0', CATALOG_URL)).toBe(
      'old build',
    );
  });

  it('requests go to the origin of the active address only', async () => {
    serveIndex(env.routes, []);
    env.routes.set(OTHER_INDEX_URL, {
      body: JSON.stringify({
        schemaVersion: 2,
        generatedAt: '2026-10-02T00:00:00Z',
        extensions: [],
        revoked: [],
      }),
    });
    const installer = open();
    await installer.catalog();
    await installer.useCatalog(OTHER_URL);
    await installer.catalog({ refresh: true });
    expect(
      callsTo(env.fake.calls, 'https://catalog.test/index.v2.json'),
    ).toHaveLength(1);
    expect(callsTo(env.fake.calls, OTHER_INDEX_URL)).toHaveLength(1);
  });

  it('a cache of the former address is not read for the new one', async () => {
    serveIndex(env.routes, [{ id: 'acme.a', version: '1.0.0' }]);
    const installer = open();
    await installer.catalog();
    env.routes.set(OTHER_INDEX_URL, { fail: true });
    await installer.useCatalog(OTHER_URL);
    // no cache for OTHER_URL and the network is down
    await expect(installer.catalog()).rejects.toMatchObject({
      cause: 'catalog-unavailable',
    });
  });

  it('a no-op switch to the same address keeps the loaded installer', async () => {
    serveIndex(env.routes, []);
    const installer = open();
    await installer.catalog();
    await installer.useCatalog(null);
    await installer.catalog();
    expect(
      callsTo(env.fake.calls, 'https://catalog.test/index.v2.json'),
    ).toHaveLength(1);
  });
});
