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
};

const info = (overrides: Partial<ExtensionInfoDto>): ExtensionInfoDto => ({
  id: 'dolphy.sql',
  version: '1.0.0',
  origin: 'bundled',
  state: 'loaded',
  contributes: { ...NO_CONTRIBUTES, exerciseTypes: ['dolphy.sql'] },
  message: null,
  permissions: [],
  isolation: 'trusted',
  toggleable: false,
  name: null,
  description: null,
  author: null,
  installed: null,
  removable: false,
  revoked: null,
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
    if (first !== undefined) first.message = 'changed';
    expect(await engine.extensions.list()).toEqual([info({})]);
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
  });
  const policy = (id: string) => ({
    id,
    extensionId: 'a.ext',
    label: id,
  });
  const contributions: RegistryContributions = {
    themes: [theme('a.ext.z'), theme('a.ext.b')],
    markdownRenderers: [renderer('math'), renderer('chart')],
    gradePolicies: [policy('a.ext.z'), policy('a.ext.b')],
  };
  const openWith = (source: RegistryContributions) =>
    createTestEngine({
      extensionRegistry: createFakeExtensionRegistry([], source),
    });

  it('sorts themes by id, renderers by language, extension policies by id', async () => {
    const { engine } = await openWith(contributions);
    const result = await engine.extensions.contributions();
    expect(result.themes.map(({ id }) => id)).toEqual(['a.ext.b', 'a.ext.z']);
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
      extensions: { disabled: ['acme.user'], trusted: [], checkUpdates: true },
    });
    const { engine, policy } = await openSettings([USER], settings);
    expect(await engine.extensions.getSettings()).toEqual({
      disabled: ['acme.user'],
      trusted: [],
      checkUpdates: true,
    });
    expect(policy.isEnabled('acme.user')).toBe(false);
  });

  it('stores, returns, announces and applies a change to the policy', async () => {
    const { engine, settings, events, policy } = await openSettings();
    expect(await engine.extensions.setEnabled('acme.user', false)).toEqual({
      disabled: ['acme.user'],
      trusted: [],
      checkUpdates: true,
    });
    expect(await engine.extensions.setTrusted('acme.user', true)).toEqual({
      disabled: ['acme.user'],
      trusted: ['acme.user'],
      checkUpdates: true,
    });
    expect(await settings.loadExtensions()).toEqual({
      disabled: ['acme.user'],
      trusted: ['acme.user'],
      checkUpdates: true,
    });
    expect(policy.isEnabled('acme.user')).toBe(false);
    expect(policy.isIsolated('acme.user')).toBe(false);
    expect(changes(events)).toHaveLength(2);
    expect(await engine.extensions.setEnabled('acme.user', true)).toEqual({
      disabled: [],
      trusted: ['acme.user'],
      checkUpdates: true,
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
