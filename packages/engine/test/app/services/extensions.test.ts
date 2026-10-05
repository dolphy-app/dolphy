import type { ExtensionInfoDto } from '@dolphy-app/engine-contract';
import {
  createFakeExtensionPolicy,
  createFakeExtensionRegistry,
  createFakeExtensionReloader,
} from '@dolphy-app/testkit';
import { createMemorySettingsStore } from '../../../src/node/memory-settings-store.ts';
import type { RegistryContributions } from '../../../src/ports/extension-registry.ts';
import { describe, expect, it } from 'vitest';
import { createTestEngine } from '../../helpers/engine.ts';

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
  id: 'dolphy.sql',
  version: '1.0.0',
  origin: 'bundled',
  state: 'loaded',
  contributes: { ...NO_CONTRIBUTES, exerciseTypes: ['dolphy.sql'] },
  diagnostics: [],
  permissions: [],
  isolation: 'trusted',
  toggleable: false,
  name: null,
  description: null,
  author: null,
  installed: null,
  icon: null,
  titles: {},
  messages: {},
  tags: [],
  removable: false,
  revoked: null,
  deprecated: null,
  ...overrides,
});

const open = (items?: ExtensionInfoDto[]) =>
  createTestEngine({
    extensionRegistry: createFakeExtensionRegistry(items),
  });

describe('extensions.list', () => {
  it('returns an empty list for an empty registry', async () => {
    const { engine } = await open();
    expect(await engine.extensions.list()).toEqual([]);
  });

  it('orders by id, then by origin priority bundled < user < dev', async () => {
    const { engine } = await open([
      info({ id: 'b.ext', origin: 'dev' }),
      info({ id: 'a.ext', origin: 'dev' }),
      info({ id: 'a.ext', origin: 'bundled', state: 'overridden' }),
      info({ id: 'a.ext', origin: 'user', state: 'overridden' }),
      info({ id: 'b.ext', origin: 'bundled' }),
    ]);
    const list = await engine.extensions.list();
    expect(list.map(({ id, origin }) => `${id}:${origin}`)).toEqual([
      'a.ext:bundled',
      'a.ext:user',
      'a.ext:dev',
      'b.ext:bundled',
      'b.ext:dev',
    ]);
  });

  it('returns copies: mutating the result does not affect the registry', async () => {
    const { engine } = await open([info({})]);
    const [first] = await engine.extensions.list();
    first?.contributes.exerciseTypes.push('evil');
    if (first !== undefined)
      first.diagnostics.push({ code: 'safe-mode', data: {} });
    expect(await engine.extensions.list()).toEqual([info({})]);
  });

  it('returns copies of titles and tags too', async () => {
    const titled = info({
      titles: { themes: { 'dolphy.sql.night': 'Night' } },
      tags: ['theme'],
    });
    const { engine } = await open([titled]);
    const [first] = await engine.extensions.list();
    first?.tags.push('developer');
    if (first?.titles.themes !== undefined) {
      first.titles.themes['dolphy.sql.night'] = 'changed';
    }
    expect(await engine.extensions.list()).toEqual([titled]);
  });
});

describe('extensions.contributions', () => {
  const theme = (id: string) => ({
    id,
    extensionId: 'a.ext',
    label: id,
    dark: false,
    colors: { background: '#ffffff' },
    variables: {},
  });
  const renderer = (language: string) => ({
    language,
    extensionId: 'a.ext',
    rendererUrl: `dolphy-ext://a.ext/${language}.mjs`,
    isolated: true,
    origin: 'user' as const,
    revision: 'rev-1',
  });
  const exerciseType = (type: string) => ({
    type,
    extensionId: 'a.ext',
    element: `${type.replaceAll('.', '-')}-answer`,
    rendererUrl: `dolphy-ext://a.ext/${type}.mjs`,
    isolated: false,
    origin: 'dev' as const,
    revision: 'rev-1',
  });
  const policy = (id: string) => ({
    id,
    extensionId: 'a.ext',
    label: id,
  });
  const contributions: RegistryContributions = {
    exerciseTypes: [exerciseType('a.ext.z'), exerciseType('a.ext.b')],
    themes: [theme('a.ext.z'), theme('a.ext.b')],
    markdownRenderers: [renderer('math'), renderer('chart')],
    gradePolicies: [policy('a.ext.z'), policy('a.ext.b')],
    settings: [],
    commands: [],
    widgets: [],
    panels: [],
    importers: [],
    exporters: [],
    messages: {},
  };
  const openWith = (source: RegistryContributions) =>
    createTestEngine({
      extensionRegistry: createFakeExtensionRegistry([], source),
    });

  it('sorts themes by id, exercise types by type, renderers by language, extension policies by id', async () => {
    const { engine } = await openWith(contributions);
    const result = await engine.extensions.contributions();
    expect(result.themes.map(({ id }) => id)).toEqual(['a.ext.b', 'a.ext.z']);
    expect(result.exerciseTypes.map(({ type }) => type)).toEqual([
      'a.ext.b',
      'a.ext.z',
    ]);
    expect(result.markdownRenderers.map(({ language }) => language)).toEqual([
      'chart',
      'math',
    ]);
    expect(result.gradePolicies.map(({ id }) => id).slice(1)).toEqual([
      'a.ext.b',
      'a.ext.z',
    ]);
  });

  it('prepends the built-in passAtN policy without extension or label', async () => {
    const { engine } = await open();
    expect((await engine.extensions.contributions()).gradePolicies).toEqual([
      { id: 'passAtN', extensionId: null, label: null },
    ]);
  });

  it('returns copies: mutating the result does not affect the registry', async () => {
    const { engine } = await openWith(contributions);
    const first = await engine.extensions.contributions();
    const [firstTheme] = first.themes;
    if (firstTheme !== undefined) firstTheme.colors['background'] = 'x';
    first.themes.pop();
    const second = await engine.extensions.contributions();
    expect(second.themes).toHaveLength(2);
    expect(second.themes[0]?.colors['background']).toBe('#ffffff');
  });

  it('passes the translation tables by extension id and returns copies of them', async () => {
    const { engine } = await openWith({
      ...contributions,
      messages: { 'a.ext': { en: { greeting: 'Hello' }, ru: {} } },
    });
    const first = await engine.extensions.contributions();
    expect(first.messages).toEqual({
      'a.ext': { en: { greeting: 'Hello' }, ru: {} },
    });
    const table = first.messages['a.ext']?.en;
    if (table !== undefined) table['greeting'] = 'changed';
    expect(
      (await engine.extensions.contributions()).messages['a.ext']?.en,
    ).toEqual({ greeting: 'Hello' });
  });
});

describe('extensions settings', () => {
  const USER = info({
    id: 'acme.user',
    origin: 'user',
    isolation: 'isolated',
    toggleable: true,
  });
  const BUNDLED = info({ id: 'dolphy.sql' });
  const OVERRIDDEN_BUNDLED = info({
    id: 'acme.user',
    origin: 'bundled',
    state: 'overridden',
  });
  const openSettings = (
    items: ExtensionInfoDto[] = [USER, BUNDLED],
    settings = createMemorySettingsStore(),
  ) => {
    const policy = createFakeExtensionPolicy();
    return createTestEngine({
      extensionRegistry: createFakeExtensionRegistry(items),
      extensionPolicy: policy,
      settings,
    }).then((t) => ({ ...t, policy }));
  };
  const changes = (events: { type: string; scope?: string }[]) =>
    events.filter(
      (event) =>
        event.type === 'settings-changed' && event.scope === 'extensions',
    );

  it('starts empty, loads stored settings into the policy at startup', async () => {
    const settings = createMemorySettingsStore({
      extensions: {
        disabled: ['acme.user'],
        trusted: [],
        checkUpdates: true,
        safeMode: false,
      },
    });
    const { engine, policy } = await openSettings([USER], settings);
    expect(await engine.extensions.getSettings()).toEqual({
      disabled: ['acme.user'],
      trusted: [],
      checkUpdates: true,
      safeMode: false,
    });
    expect(policy.isEnabled('acme.user')).toBe(false);
  });

  it('stores, returns, announces and applies a change to the policy', async () => {
    const { engine, settings, events, policy } = await openSettings();
    expect(await engine.extensions.setEnabled('acme.user', false)).toEqual({
      disabled: ['acme.user'],
      trusted: [],
      checkUpdates: true,
      safeMode: false,
    });
    expect(await engine.extensions.setTrusted('acme.user', true)).toEqual({
      disabled: ['acme.user'],
      trusted: ['acme.user'],
      checkUpdates: true,
      safeMode: false,
    });
    expect(await settings.loadExtensions()).toEqual({
      disabled: ['acme.user'],
      trusted: ['acme.user'],
      checkUpdates: true,
      safeMode: false,
    });
    expect(policy.isEnabled('acme.user')).toBe(false);
    expect(policy.isIsolated('acme.user')).toBe(false);
    expect(changes(events)).toHaveLength(2);
    expect(await engine.extensions.setEnabled('acme.user', true)).toEqual({
      disabled: [],
      trusted: ['acme.user'],
      checkUpdates: true,
      safeMode: false,
    });
    expect(policy.isEnabled('acme.user')).toBe(true);
  });

  it('is idempotent: repeating a write changes and announces nothing', async () => {
    const { engine, events } = await openSettings();
    await engine.extensions.setTrusted('acme.user', true);
    const again = await engine.extensions.setTrusted('acme.user', true);
    expect(again).toEqual({
      disabled: [],
      trusted: ['acme.user'],
      checkUpdates: true,
      safeMode: false,
    });
    expect(await engine.extensions.setEnabled('acme.user', true)).toEqual(
      again,
    );
    expect(changes(events)).toHaveLength(1);
  });

  it('rejects an unknown id with NOT_FOUND and a malformed one with INVALID_ARGUMENT', async () => {
    const { engine, settings } = await openSettings();
    await expect(
      engine.extensions.setEnabled('acme.missing', false),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      engine.extensions.setTrusted('Not An Id', true),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(await settings.loadExtensions()).toEqual({
      disabled: [],
      trusted: [],
      checkUpdates: true,
      safeMode: false,
    });
  });

  it('rejects a bundled extension with reason bundled', async () => {
    const { engine, events } = await openSettings();
    for (const call of [
      () => engine.extensions.setEnabled('dolphy.sql', false),
      () => engine.extensions.setTrusted('dolphy.sql', true),
    ]) {
      await expect(call()).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        details: { reason: 'bundled' },
      });
    }
    expect(changes(events)).toEqual([]);
  });

  it('a user copy of a bundled id is configurable; the overridden bundled entry is not the target', async () => {
    const { engine } = await openSettings([OVERRIDDEN_BUNDLED, USER]);
    expect(await engine.extensions.setEnabled('acme.user', false)).toEqual({
      disabled: ['acme.user'],
      trusted: [],
      checkUpdates: true,
      safeMode: false,
    });
  });

  it('rejects an extension that is not loaded (invalid or overridden only)', async () => {
    const { engine } = await openSettings([
      info({ id: 'acme.broken', origin: 'user', state: 'invalid' }),
    ]);
    await expect(
      engine.extensions.setEnabled('acme.broken', false),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { reason: 'not-loaded' },
    });
  });

  it('keeps the live policy when the store refuses the write', async () => {
    const base = createMemorySettingsStore();
    const settings = {
      ...base,
      saveExtensions: async () => {
        throw new Error('disk full');
      },
    };
    const { engine, policy } = await openSettings([USER], settings);
    await expect(
      engine.extensions.setEnabled('acme.user', false),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(policy.isEnabled('acme.user')).toBe(true);
  });
});

describe('extensions live apply', () => {
  const USER = info({
    id: 'acme.user',
    origin: 'user',
    isolation: 'isolated',
    toggleable: true,
  });
  const openApplying = (settings = createMemorySettingsStore()) => {
    const order: string[] = [];
    const reloader = createFakeExtensionReloader(() => {
      order.push('reload');
    });
    return createTestEngine({
      extensionRegistry: createFakeExtensionRegistry([USER]),
      extensionReloader: reloader,
      settings,
    }).then((t) => {
      t.engine.subscribe((event) => {
        order.push(event.type);
      });
      return { ...t, reloader, order };
    });
  };

  it('setEnabled and setTrusted apply the set before announcing contributions-changed', async () => {
    const { engine, order, events } = await openApplying();
    await engine.extensions.setEnabled('acme.user', false);
    await engine.extensions.setTrusted('acme.user', true);
    expect(order.filter((type) => type !== 'settings-changed')).toEqual([
      'reload',
      'contributions-changed',
      'reload',
      'contributions-changed',
    ]);
    expect(
      events.filter(({ type }) => type === 'contributions-changed'),
    ).toEqual([
      { type: 'contributions-changed', generation: 1 },
      { type: 'contributions-changed', generation: 2 },
    ]);
  });

  it('applies nothing when a write changes nothing or only the update check', async () => {
    const { engine, reloader } = await openApplying();
    await engine.extensions.setCheckUpdates(false);
    await engine.extensions.setEnabled('acme.user', true);
    expect(reloader.calls()).toBe(0);
  });

  it('contributions carry the generation of the last applied set', async () => {
    const { engine } = await openApplying();
    expect((await engine.extensions.contributions()).generation).toBe(0);
    await engine.extensions.setEnabled('acme.user', false);
    expect((await engine.extensions.contributions()).generation).toBe(1);
  });

  it('reloadExtensions applies without a command and announces once', async () => {
    const { engine, reloader, events } = await openApplying();
    await engine.reloadExtensions();
    expect(reloader.calls()).toBe(1);
    expect(events).toEqual([{ type: 'contributions-changed', generation: 1 }]);
  });

  it('does not apply when the settings write is refused', async () => {
    const base = createMemorySettingsStore();
    const { engine, reloader } = await openApplying({
      ...base,
      saveExtensions: async () => {
        throw new Error('disk full');
      },
    });
    await expect(
      engine.extensions.setEnabled('acme.user', false),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(reloader.calls()).toBe(0);
  });
});

describe('extensions safe mode', () => {
  const USER = info({
    id: 'acme.user',
    origin: 'user',
    isolation: 'isolated',
    toggleable: true,
  });
  const open = (
    config: { forceSafeMode?: 'flag' | 'env' } = {},
    settings = createMemorySettingsStore(),
  ) => {
    const reloader = createFakeExtensionReloader();
    const policy = createFakeExtensionPolicy({
      ...(config.forceSafeMode !== undefined && { forceSafeMode: true }),
    });
    return createTestEngine({
      extensionRegistry: createFakeExtensionRegistry([USER]),
      extensionPolicy: policy,
      extensionReloader: reloader,
      config,
      settings,
    }).then((t) => ({ ...t, reloader, policy }));
  };

  it('defaults to off, stores the flag, applies the set at once and announces once', async () => {
    const { engine, settings, policy, reloader, events } = await open();
    expect((await engine.extensions.getSettings()).safeMode).toBe(false);

    const next = await engine.extensions.setSafeMode(true);

    expect(next.safeMode).toBe(true);
    expect((await settings.loadExtensions()).safeMode).toBe(true);
    expect(policy.safeMode()).toBe(true);
    expect(reloader.calls()).toBe(1);
    expect(events).toContainEqual({
      type: 'contributions-changed',
      generation: 1,
    });

    await engine.extensions.setSafeMode(true);
    expect(reloader.calls()).toBe(1);

    expect((await engine.extensions.setSafeMode(false)).safeMode).toBe(false);
    expect(policy.safeMode()).toBe(false);
    expect(reloader.calls()).toBe(2);
  });

  it('keeps the disabled and trusted lists and the update check', async () => {
    const { engine } = await open();
    await engine.extensions.setEnabled('acme.user', false);
    await engine.extensions.setCheckUpdates(false);
    expect(await engine.extensions.setSafeMode(true)).toEqual({
      disabled: ['acme.user'],
      trusted: [],
      checkUpdates: false,
      safeMode: true,
    });
  });

  it.each([['yes'], [1], [null], [undefined]])(
    'rejects %j: INVALID_ARGUMENT, nothing stored or applied',
    async (value) => {
      const { engine, settings, reloader } = await open();
      await expect(
        engine.extensions.setSafeMode(value as never),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      expect((await settings.loadExtensions()).safeMode).toBe(false);
      expect(reloader.calls()).toBe(0);
    },
  );

  it('a stored setting is effective right after startup', async () => {
    const settings = createMemorySettingsStore({
      extensions: {
        disabled: [],
        trusted: [],
        checkUpdates: true,
        safeMode: true,
      },
    });
    const { engine, policy } = await open({}, settings);
    expect(policy.safeMode()).toBe(true);
    expect((await engine.extensions.diagnostics()).safeMode).toEqual({
      active: true,
      persisted: true,
      forcedBy: null,
    });
  });

  it.each(['flag', 'env'] as const)(
    'a launch %s is active without the setting and survives turning the setting off',
    async (forceSafeMode) => {
      const { engine, policy } = await open({ forceSafeMode });
      expect((await engine.extensions.diagnostics()).safeMode).toEqual({
        active: true,
        persisted: false,
        forcedBy: forceSafeMode,
      });
      await engine.extensions.setSafeMode(true);
      await engine.extensions.setSafeMode(false);
      expect((await engine.extensions.diagnostics()).safeMode).toEqual({
        active: true,
        persisted: false,
        forcedBy: forceSafeMode,
      });
      expect(policy.isEnabled('acme.user')).toBe(false);
    },
  );

  it('does not apply when the settings write is refused', async () => {
    const base = createMemorySettingsStore();
    const { engine, policy, reloader } = await open(
      {},
      {
        ...base,
        saveExtensions: async () => {
          throw new Error('disk full');
        },
      },
    );
    await expect(engine.extensions.setSafeMode(true)).rejects.toMatchObject({
      code: 'INTERNAL',
    });
    expect(policy.safeMode()).toBe(false);
    expect(reloader.calls()).toBe(0);
  });
});
