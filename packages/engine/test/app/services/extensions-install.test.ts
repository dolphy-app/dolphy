import type {
  CatalogDto,
  ExtensionInfoDto,
  ExtensionUpdateDto,
} from '@dolphy-app/engine-contract';
import {
  FAKE_CATALOG_URL,
  createFakeExtensionInstaller,
  createFakeExtensionPolicy,
  createFakeExtensionRegistry,
} from '@dolphy-app/testkit';
import type { FakeExtensionInstallerOptions } from '@dolphy-app/testkit';
import { describe, expect, it } from 'vitest';
import {
  UPDATE_CHECK_INTERVAL_MS,
  runStartupUpdateCheck,
} from '../../../src/app/services/extensions.ts';
import { createMemorySettingsStore } from '../../../src/node/memory-settings-store.ts';
import { ExtensionInstallError } from '../../../src/ports/extension-installer.ts';
import { createTestContext, createTestEngine } from '../../helpers/engine.ts';

const NO_CONTRIBUTES: ExtensionInfoDto['contributes'] = {
  exerciseTypes: [],
  themes: [],
  markdownRenderers: [],
  gradePolicies: [],
  settings: [],
  events: [],
  commands: [],
  widgets: [],
  panels: [],
  importers: [],
  exporters: [],
};

const info = (overrides: Partial<ExtensionInfoDto>): ExtensionInfoDto => ({
  id: 'acme.user',
  version: '1.0.0',
  origin: 'user',
  state: 'loaded',
  contributes: NO_CONTRIBUTES,
  diagnostics: [],
  permissions: [],
  isolation: 'isolated',
  toggleable: true,
  name: null,
  description: null,
  author: null,
  installed: null,
  icon: null,
  titles: {},
  messages: {},
  tags: [],
  removable: true,
  revoked: null,
  deprecated: null,
  ...overrides,
});

const CATALOG: CatalogDto = {
  entries: [],
  fetchedAt: '2026-10-01T00:00:00.000Z',
  stale: false,
  error: null,
};

const UPDATE: ExtensionUpdateDto = {
  id: 'acme.user',
  name: 'Acme',
  installed: '1.0.0',
  available: {
    version: '1.1.0',
    permissions: [],
    publishedAt: '2026-10-01T00:00:00.000Z',
    size: 10,
    minAppVersion: null,
  },
};

const open = (
  items: ExtensionInfoDto[],
  installerOptions: FakeExtensionInstallerOptions = {},
) => {
  const installer = createFakeExtensionInstaller(installerOptions);
  return createTestEngine({
    extensionRegistry: createFakeExtensionRegistry(items),
    extensionInstaller: installer,
  }).then((t) => ({ ...t, installer }));
};

const failing = (
  cause: ConstructorParameters<typeof ExtensionInstallError>[0],
) =>
  createFakeExtensionInstaller({
    handlers: {
      catalog: async () => {
        throw new ExtensionInstallError(cause, 'acme.user', `failed: ${cause}`);
      },
      install: async () => {
        throw new ExtensionInstallError(cause, 'acme.user', `failed: ${cause}`);
      },
      uninstall: async () => {
        throw new ExtensionInstallError(cause, 'acme.user', `failed: ${cause}`);
      },
    },
  });

describe('extensions.catalog / updates', () => {
  it('pass the options through and return the installer result', async () => {
    const { engine, installer } = await open([], {
      catalog: CATALOG,
      updates: [UPDATE],
    });
    expect(await engine.extensions.catalog({ refresh: true })).toEqual(CATALOG);
    expect(await engine.extensions.updates()).toEqual([UPDATE]);
    expect(
      installer.calls.filter(({ method }) => method === 'catalog'),
    ).toEqual([{ method: 'catalog', args: [{ refresh: true }] }]);
  });

  it('maps catalog-unavailable to a retryable CATALOG_UNAVAILABLE', async () => {
    const { engine } = await createTestEngine({
      extensionInstaller: failing('catalog-unavailable'),
    });
    await expect(engine.extensions.catalog()).rejects.toMatchObject({
      code: 'CATALOG_UNAVAILABLE',
      retryable: true,
    });
  });
});

describe('extensions.install', () => {
  it('installs, announces extensions-changed and returns the result', async () => {
    const { engine, events, installer } = await open([]);
    expect(await engine.extensions.install('acme.new', '2.0.0')).toEqual({
      id: 'acme.new',
      version: '2.0.0',
      previousVersion: null,
    });
    expect(events.filter(({ type }) => type === 'extensions-changed')).toEqual([
      { type: 'extensions-changed' },
    ]);
    expect(
      installer.calls.filter(({ method }) => method === 'install'),
    ).toEqual([{ method: 'install', args: ['acme.new', '2.0.0'] }]);
  });

  it('rejects a malformed id without calling the installer', async () => {
    const { engine, installer } = await open([]);
    await expect(engine.extensions.install('Not An Id')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    expect(installer.calls.some(({ method }) => method === 'install')).toBe(
      false,
    );
  });

  it.each([
    ['not-found', 'NOT_FOUND', undefined],
    ['catalog-unavailable', 'CATALOG_UNAVAILABLE', true],
    ['network', 'EXTENSION_INSTALL_FAILED', true],
    ['incompatible', 'EXTENSION_INSTALL_FAILED', false],
    ['integrity', 'EXTENSION_INSTALL_FAILED', false],
    ['limits', 'EXTENSION_INSTALL_FAILED', false],
    ['invalid', 'EXTENSION_INSTALL_FAILED', false],
    ['conflict', 'EXTENSION_INSTALL_FAILED', false],
  ] as const)(
    'maps installer failure %s to %s and announces nothing',
    async (cause, code, retryable) => {
      const { engine, events } = await createTestEngine({
        extensionInstaller: failing(cause),
      });
      const error = await engine.extensions
        .install('acme.user')
        .catch((failure: unknown) => failure);
      expect(error).toMatchObject({ code });
      if (retryable !== undefined) expect(error).toMatchObject({ retryable });
      if (code === 'EXTENSION_INSTALL_FAILED') {
        expect(error).toMatchObject({
          details: { reason: cause, extensionId: 'acme.user' },
        });
      }
      expect(events.some(({ type }) => type === 'extensions-changed')).toBe(
        false,
      );
    },
  );

  it('does not hold the command queue while the download runs', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { engine } = await open([], {
      handlers: {
        install: async (id) => {
          await gate;
          return {
            id,
            version: '1.0.0',
            previousVersion: null,
          };
        },
      },
    });
    const pending = engine.extensions.install('acme.slow');
    await expect(engine.extensions.getSettings()).resolves.toBeDefined();
    release?.();
    await expect(pending).resolves.toMatchObject({ id: 'acme.slow' });
  });
});

describe('extensions.uninstall', () => {
  it('validates through the registry before the installer, then announces', async () => {
    const { engine, events, installer } = await open([
      info({}),
      info({ id: 'dolphy.sql', origin: 'bundled', removable: false }),
    ]);
    await expect(
      engine.extensions.uninstall('acme.nope'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      engine.extensions.uninstall('dolphy.sql'),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { reason: 'not-removable' },
    });
    await expect(
      engine.extensions.uninstall('Not An Id'),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(installer.calls.some(({ method }) => method === 'uninstall')).toBe(
      false,
    );
    await engine.extensions.uninstall('acme.user');
    expect(
      installer.calls.filter(({ method }) => method === 'uninstall'),
    ).toEqual([{ method: 'uninstall', args: ['acme.user'] }]);
    expect(
      events.filter(({ type }) => type === 'extensions-changed'),
    ).toHaveLength(1);
  });

  it('a broken user extension (invalid state) is removable', async () => {
    const { engine } = await open([
      info({ state: 'invalid', toggleable: false }),
    ]);
    await expect(
      engine.extensions.uninstall('acme.user'),
    ).resolves.toBeUndefined();
  });

  it('maps an installer failure and announces nothing', async () => {
    const { engine, events } = await createTestEngine({
      extensionRegistry: createFakeExtensionRegistry([info({})]),
      extensionInstaller: failing('not-found'),
    });
    await expect(
      engine.extensions.uninstall('acme.user'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(events.some(({ type }) => type === 'extensions-changed')).toBe(
      false,
    );
  });
});

describe('extensions.setCheckUpdates', () => {
  it('stores the flag, announces once, and is idempotent', async () => {
    const policy = createFakeExtensionPolicy();
    const { engine, settings, events } = await createTestEngine({
      extensionPolicy: policy,
    });
    expect(await engine.extensions.setCheckUpdates(false)).toEqual({
      disabled: [],
      trusted: [],
      checkUpdates: false,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
    });
    await engine.extensions.setCheckUpdates(false);
    expect((await settings.loadExtensions()).checkUpdates).toBe(false);
    expect((await engine.extensions.getSettings()).checkUpdates).toBe(false);
    expect(policy.updates.at(-1)?.checkUpdates).toBe(false);
    expect(
      events.filter(
        (event) =>
          event.type === 'settings-changed' && event.scope === 'extensions',
      ),
    ).toHaveLength(1);
  });

  it('keeps the disabled and trusted lists', async () => {
    const { engine } = await createTestEngine({
      extensionRegistry: createFakeExtensionRegistry([info({})]),
    });
    await engine.extensions.setEnabled('acme.user', false);
    expect(await engine.extensions.setCheckUpdates(false)).toEqual({
      disabled: ['acme.user'],
      trusted: [],
      checkUpdates: false,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
    });
  });
});

describe('revoked extensions', () => {
  const REVOKED = info({
    state: 'disabled',
    toggleable: false,
    revoked: 'compromised build',
  });

  it('cannot be enabled or disabled; trust stays settable', async () => {
    const { engine, settings } = await createTestEngine({
      extensionRegistry: createFakeExtensionRegistry([REVOKED]),
    });
    for (const enabled of [true, false]) {
      await expect(
        engine.extensions.setEnabled('acme.user', enabled),
      ).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        details: { reason: 'revoked', extensionId: 'acme.user' },
      });
    }
    expect((await settings.loadExtensions()).disabled).toEqual([]);
    await expect(
      engine.extensions.setTrusted('acme.user', true),
    ).resolves.toMatchObject({ trusted: ['acme.user'] });
  });
});

describe('startup update check', () => {
  const setup = async (
    installerOptions: FakeExtensionInstallerOptions = {},
    settings = createMemorySettingsStore(),
  ) => {
    const installer = createFakeExtensionInstaller(installerOptions);
    const context = await createTestContext({
      extensionInstaller: installer,
      settings,
    });
    const published: string[] = [];
    context.ctx.bus.subscribe((event) => published.push(event.type));
    return { ...context, installer, published };
  };
  const checks = (installer: { calls: { method: string }[] }) =>
    installer.calls.filter(({ method }) => method === 'checkForUpdates');

  it('checks after ready(), stamps the time and announces when updates exist', async () => {
    const { ctx, installer, settings, clock, published } = await setup({
      updates: [UPDATE],
    });
    await runStartupUpdateCheck(ctx);
    expect(installer.calls.map(({ method }) => method)).toEqual([
      'ready',
      'checkForUpdates',
    ]);
    expect(await settings.loadUpdateCheckedAt()).toBe(clock.now());
    expect(published).toEqual(['extensions-changed']);
  });

  it('stays quiet when nothing is available', async () => {
    const { ctx, installer, published, settings, clock } = await setup();
    await runStartupUpdateCheck(ctx);
    expect(checks(installer)).toHaveLength(1);
    expect(published).toEqual([]);
    expect(await settings.loadUpdateCheckedAt()).toBe(clock.now());
  });

  it('does nothing when the setting is off', async () => {
    const settings = createMemorySettingsStore({
      extensions: {
        disabled: [],
        trusted: [],
        checkUpdates: false,
        safeMode: false,
        notificationsOff: [],
        catalogUrl: null,
      },
    });
    const { ctx, installer } = await setup({ updates: [UPDATE] }, settings);
    await runStartupUpdateCheck(ctx);
    expect(checks(installer)).toHaveLength(0);
    expect(await settings.loadUpdateCheckedAt()).toBeNull();
  });

  it('respects the 24 hour interval', async () => {
    const { ctx, installer, settings, clock } = await setup();
    await settings.saveUpdateCheckedAt(clock.now());
    clock.advance(UPDATE_CHECK_INTERVAL_MS - 1);
    await runStartupUpdateCheck(ctx);
    expect(checks(installer)).toHaveLength(0);
    clock.advance(1);
    await runStartupUpdateCheck(ctx);
    expect(checks(installer)).toHaveLength(1);
  });

  it('treats a stamp from the future as stale', async () => {
    const { ctx, installer, settings, clock } = await setup();
    await settings.saveUpdateCheckedAt(clock.now() + UPDATE_CHECK_INTERVAL_MS);
    await runStartupUpdateCheck(ctx);
    expect(checks(installer)).toHaveLength(1);
  });

  it('logs a failure instead of throwing and leaves the stamp alone', async () => {
    const { ctx, logs, settings } = await setup({
      handlers: {
        checkForUpdates: async () => {
          throw new Error('boom');
        },
      },
    });
    await expect(runStartupUpdateCheck(ctx)).resolves.toBeUndefined();
    expect(logs.some(({ level }) => level === 'warn')).toBe(true);
    expect(await settings.loadUpdateCheckedAt()).toBeNull();
  });

  it('does not delay opening the engine: a hanging check never blocks commands', async () => {
    const { engine, installer } = await open([], {
      handlers: { checkForUpdates: () => new Promise<number>(() => {}) },
    });
    await engine.extensions.getSettings();
    await expect.poll(() => checks(installer).length).toBe(1);
    await expect(engine.extensions.list()).resolves.toEqual([]);
  });
});

describe('extensions.list: deprecation overlay', () => {
  const DEPRECATION = {
    versions: '<2.0.0',
    reason: 'Replaced',
    alternatives: [{ id: 'acme.new', name: 'New' }],
  };
  const fromCatalog = {
    catalogUrl: FAKE_CATALOG_URL,
    version: '1.0.0',
    installedAt: '2026-10-01T00:00:00.000Z',
  };

  it('marks an extension installed from the catalog and leaves state and revoked alone', async () => {
    const { engine } = await open(
      [
        info({ installed: fromCatalog }),
        info({ id: 'acme.manual', installed: null }),
        info({ id: 'dolphy.sql', origin: 'bundled', removable: false }),
      ],
      {
        deprecated: {
          'acme.user': DEPRECATION,
          'acme.manual': DEPRECATION,
          'dolphy.sql': DEPRECATION,
        },
      },
    );
    const byId = Object.fromEntries(
      (await engine.extensions.list()).map((item) => [item.id, item]),
    );
    expect(byId['acme.user']).toMatchObject({
      deprecated: DEPRECATION,
      state: 'loaded',
      revoked: null,
    });
    // not installed from the catalog: the catalog's deprecation is not about it
    expect(byId['acme.manual']?.deprecated).toBeNull();
    expect(byId['dolphy.sql']?.deprecated).toBeNull();
  });

  it('ignores the deprecation of the current catalog for an extension installed from another one', async () => {
    const { engine } = await open(
      [
        info({
          installed: { ...fromCatalog, catalogUrl: 'https://old.test/i.json' },
        }),
      ],
      { deprecated: { 'acme.user': DEPRECATION } },
    );
    expect((await engine.extensions.list())[0]?.deprecated).toBeNull();
  });

  it('asks the installer about the installed version', async () => {
    let asked: [string, string] | null = null;
    const installer = createFakeExtensionInstaller();
    installer.deprecationOf = (id, version) => {
      asked = [id, version];
      return null;
    };
    const { engine } = await createTestEngine({
      extensionRegistry: createFakeExtensionRegistry([
        info({ version: '1.4.0', installed: fromCatalog }),
      ]),
      extensionInstaller: installer,
    });
    await engine.extensions.list();
    expect(asked).toEqual(['acme.user', '1.4.0']);
  });
});

describe('extensions.docs / docImage', () => {
  const DOCS = {
    version: '1.0.0',
    readme: '# Hi',
    changelog: null,
    truncated: false,
    source: 'catalog' as const,
  };

  it('pass the arguments through and return the installer result', async () => {
    const { engine, installer } = await open([], {
      handlers: {
        docs: () => DOCS,
        docImage: () => 'data:image/png;base64,AA==',
      },
    });
    expect(await engine.extensions.docs('acme.user')).toEqual(DOCS);
    expect(
      await engine.extensions.docs('acme.user', { version: '1.0.0' }),
    ).toEqual(DOCS);
    expect(
      await engine.extensions.docImage('acme.user', '1.0.0', 'docs/a.png'),
    ).toBe('data:image/png;base64,AA==');
    expect(
      installer.calls
        .filter(({ method }) => method.startsWith('doc'))
        .map(({ method, args }) => [method, args]),
    ).toEqual([
      ['docs', ['acme.user']],
      ['docs', ['acme.user', '1.0.0']],
      ['docImage', ['acme.user', '1.0.0', 'docs/a.png']],
    ]);
  });

  it('reject malformed arguments without calling the installer', async () => {
    const { engine, installer } = await open([]);
    const bad = [
      engine.extensions.docs('Not An Id'),
      engine.extensions.docs('acme.user', { version: 'latest' }),
      engine.extensions.docImage('Not An Id', '1.0.0', 'a.png'),
      engine.extensions.docImage('acme.user', 'latest', 'a.png'),
      engine.extensions.docImage('acme.user', '1.0.0', 'a.gif'),
      engine.extensions.docImage('acme.user', '1.0.0', '../a.png'),
      engine.extensions.docImage('acme.user', '1.0.0', '/a.png'),
      engine.extensions.docImage(
        'acme.user',
        '1.0.0',
        `${'d/'.repeat(100)}a.png`,
      ),
    ];
    for (const call of bad) {
      await expect(call).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
    expect(
      installer.calls.filter(({ method }) => method.startsWith('doc')),
    ).toEqual([]);
  });

  it.each([
    ['not-found', 'NOT_FOUND'],
    ['catalog-unavailable', 'CATALOG_UNAVAILABLE'],
    ['network', 'EXTENSION_INSTALL_FAILED'],
    ['integrity', 'EXTENSION_INSTALL_FAILED'],
    ['limits', 'EXTENSION_INSTALL_FAILED'],
  ] as const)('map installer failure %s to %s', async (cause, code) => {
    const fail = () => {
      throw new ExtensionInstallError(cause, 'acme.user', `failed: ${cause}`);
    };
    const { engine } = await open([], {
      handlers: { docs: fail, docImage: fail },
    });
    await expect(engine.extensions.docs('acme.user')).rejects.toMatchObject({
      code,
    });
    await expect(
      engine.extensions.docImage('acme.user', '1.0.0', 'a.png'),
    ).rejects.toMatchObject({ code });
  });

  it('do not hold the command queue while the download runs', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { engine } = await open([], {
      handlers: {
        docs: async () => {
          await gate;
          return DOCS;
        },
      },
    });
    const pending = engine.extensions.docs('acme.slow');
    await expect(engine.extensions.getSettings()).resolves.toBeDefined();
    release?.();
    await expect(pending).resolves.toEqual(DOCS);
  });
});

describe('extensions.setCatalogUrl / catalogSource', () => {
  const OTHER = 'http://127.0.0.1:4010/index.json';

  const reasonOf = async (
    run: Promise<unknown>,
  ): Promise<string | undefined> => {
    try {
      await run;
    } catch (error) {
      return (error as { details?: { reason?: string } }).details?.reason;
    }
    return undefined;
  };

  it('reports the default source until a custom address is applied', async () => {
    const { engine } = await open([]);
    expect(await engine.extensions.catalogSource()).toEqual({
      url: FAKE_CATALOG_URL,
      default: FAKE_CATALOG_URL,
      origin: 'default',
    });
  });

  it.each([
    ['not a URL', 'catalog', 'not-url'],
    ['a non-https scheme', 'ftp://example.test/index.json', 'scheme'],
    ['http on a non-loopback host', 'http://example.test/index.json', 'scheme'],
    ['credentials', 'https://user:pw@example.test/index.json', 'credentials'],
    ['a fragment', 'https://example.test/index.json#x', 'fragment'],
    ['an empty fragment', 'https://example.test/index.json#', 'fragment'],
    ['a non-.json path', 'https://example.test/catalog/', 'not-json'],
    [
      'more than 2048 characters',
      `https://example.test/${'a'.repeat(2048)}.json`,
      'too-long',
    ],
  ])('rejects %s and changes nothing', async (_name, url, reason) => {
    const { engine, installer, settings } = await open([]);
    expect(await reasonOf(engine.extensions.setCatalogUrl(url))).toBe(reason);
    expect((await settings.loadExtensions()).catalogUrl).toBeNull();
    expect(installer.calls.map(({ method }) => method)).not.toContain(
      'useCatalog',
    );
  });

  it('accepts https and loopback http, canonicalises, and applies at once', async () => {
    const { engine, installer, settings, published } = await openSwitching();
    const saved = await engine.extensions.setCatalogUrl(
      'HTTPS://Example.test/a/../index.json',
    );
    expect(saved.catalogUrl).toBe('https://example.test/index.json');
    expect(await engine.extensions.catalogSource()).toEqual({
      url: 'https://example.test/index.json',
      default: FAKE_CATALOG_URL,
      origin: 'setting',
    });
    expect((await settings.loadExtensions()).catalogUrl).toBe(
      'https://example.test/index.json',
    );
    expect(installer.calls).toContainEqual({
      method: 'useCatalog',
      args: ['https://example.test/index.json'],
    });
    for (const url of [OTHER, 'http://localhost:1/i.json', 'http://[::1]/i.json']) {
      await expect(engine.extensions.setCatalogUrl(url)).resolves.toMatchObject(
        { catalogUrl: new URL(url).href },
      );
    }
    expect(published()).toContain('extensions-changed');
  });

  it('stores the default address as "not set" and resets with null', async () => {
    const { engine, settings } = await openSwitching();
    await engine.extensions.setCatalogUrl(OTHER);
    expect((await settings.loadExtensions()).catalogUrl).toBe(OTHER);
    expect(
      (await engine.extensions.setCatalogUrl(FAKE_CATALOG_URL)).catalogUrl,
    ).toBeNull();
    expect((await engine.extensions.catalogSource()).origin).toBe('default');
    await engine.extensions.setCatalogUrl(OTHER);
    expect((await engine.extensions.setCatalogUrl(null)).catalogUrl).toBeNull();
    expect(await engine.extensions.catalogSource()).toMatchObject({
      url: FAKE_CATALOG_URL,
      origin: 'default',
    });
  });

  it('resets the update-check stamp and checks again against the new catalog', async () => {
    const { engine, installer, settings, clock } = await openSwitching();
    await expect
      .poll(async () => await settings.loadUpdateCheckedAt())
      .toBe(clock.now());
    const before = installer.calls.filter(
      ({ method }) => method === 'checkForUpdates',
    ).length;
    await engine.extensions.setCatalogUrl(OTHER);
    await expect
      .poll(
        () =>
          installer.calls.filter(({ method }) => method === 'checkForUpdates')
            .length,
      )
      .toBe(before + 1);
  });

  it('keeps the setting when applying to the same address again (no switch, no events)', async () => {
    const { engine, installer, published } = await openSwitching();
    await engine.extensions.setCatalogUrl(OTHER);
    const switches = () =>
      installer.calls.filter(({ method }) => method === 'useCatalog').length;
    const events = published().length;
    await engine.extensions.setCatalogUrl(OTHER);
    expect(switches()).toBe(1);
    expect(published()).toHaveLength(events);
  });

  it('refuses to change an address set by the environment', async () => {
    const installer = createFakeExtensionInstaller({
      catalogUrl: OTHER,
      origin: 'env',
    });
    const { engine, settings } = await createTestEngine({
      extensionInstaller: installer,
    });
    expect(
      await reasonOf(
        engine.extensions.setCatalogUrl('https://example.test/index.json'),
      ),
    ).toBe('env');
    expect(await reasonOf(engine.extensions.setCatalogUrl(null))).toBe('env');
    expect((await settings.loadExtensions()).catalogUrl).toBeNull();
    expect(await engine.extensions.catalogSource()).toMatchObject({
      url: OTHER,
      origin: 'env',
    });
  });
});

const openSwitching = async () => {
  const installer = createFakeExtensionInstaller();
  const t = await createTestEngine({ extensionInstaller: installer });
  return {
    ...t,
    installer,
    published: () => t.events.map(({ type }) => type as string),
  };
};
