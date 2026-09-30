import type {
  CatalogDto,
  ExtensionInfoDto,
  ExtensionUpdateDto,
} from '@dolphy-app/engine-contract';
import {
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
};

const info = (overrides: Partial<ExtensionInfoDto>): ExtensionInfoDto => ({
  id: 'acme.user',
  version: '1.0.0',
  origin: 'user',
  state: 'loaded',
  contributes: NO_CONTRIBUTES,
  message: null,
  permissions: [],
  isolation: 'isolated',
  toggleable: true,
  name: null,
  description: null,
  author: null,
  installed: null,
  removable: true,
  revoked: null,
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
      restartRequired: true,
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
            restartRequired: true,
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
    });
  });
});

describe('revoked extensions', () => {
  const REVOKED = info({
    state: 'disabled',
    toggleable: false,
    revoked: 'compromised build',
    message: 'compromised build',
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
      extensions: { disabled: [], trusted: [], checkUpdates: false },
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
