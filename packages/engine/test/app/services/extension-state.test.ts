/**
 * Состояние расширений на стороне движка (спека extension-state): значения
 * настроек, хранилище для хоста расширений, данные при удалении.
 */
import type {
  ExtensionInfoDto,
  ExtensionSettingChangeDto,
  ExtensionSettingDefDto,
} from '@dolphy-app/engine-contract';
import {
  createFakeExtensionInstaller,
  createFakeExtensionPolicy,
  createFakeExtensionRegistry,
} from '@dolphy-app/testkit';
import { describe, expect, it } from 'vitest';
import { EXTENSION_STORAGE_LIMITS } from '../../../src/domain/index.ts';
import { createTestEngine } from '../../helpers/engine.ts';
import type { TestEngine } from '../../helpers/engine.ts';

const base = {
  version: '1.0.0',
  state: 'loaded' as const,
  contributes: {
    exerciseTypes: [],
    themes: [],
    markdownRenderers: [],
    gradePolicies: [],
    settings: [],
    events: [],
    commands: [],
    panels: [],
  },
  message: null,
  permissions: [],
  isolation: 'isolated' as const,
  toggleable: true,
  name: null,
  description: null,
  author: null,
  installed: null,
  icon: null,
  removable: true,
  revoked: null,
};
const ext = (id: string, patch: Partial<ExtensionInfoDto> = {}) => ({
  ...base,
  id,
  origin: 'user' as const,
  ...patch,
});

const meta = { description: null } as const;
const DEFS: ExtensionSettingDefDto[] = [
  {
    ...meta,
    id: 'acme.user.fancy',
    extensionId: 'acme.user',
    type: 'boolean',
    label: 'Fancy',
    default: false,
  },
  {
    ...meta,
    id: 'acme.user.name',
    extensionId: 'acme.user',
    type: 'string',
    label: 'Name',
    default: 'abc',
    maxLength: 5,
  },
  {
    ...meta,
    id: 'acme.user.count',
    extensionId: 'acme.user',
    type: 'number',
    label: 'Count',
    default: 3,
    min: 1,
    max: 10,
    integer: true,
  },
  {
    ...meta,
    id: 'acme.user.ratio',
    extensionId: 'acme.user',
    type: 'number',
    label: 'Ratio',
    default: 0.5,
    min: 0,
    max: 1,
    integer: false,
  },
  {
    ...meta,
    id: 'acme.user.mode',
    extensionId: 'acme.user',
    type: 'enum',
    label: 'Mode',
    default: 'a',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ],
  },
  {
    ...meta,
    id: 'dolphy.bundled.flag',
    extensionId: 'dolphy.bundled',
    type: 'boolean',
    label: 'Flag',
    default: true,
  },
];

const open = (installer = createFakeExtensionInstaller()) =>
  createTestEngine({
    extensionRegistry: createFakeExtensionRegistry(
      [
        ext('acme.user'),
        ext('dolphy.bundled', { origin: 'bundled', toggleable: false }),
        ext('acme.off', { state: 'disabled' }),
      ],
      {
        exerciseTypes: [],
        themes: [],
        markdownRenderers: [],
        gradePolicies: [],
        settings: DEFS,
        commands: [],
        panels: [],
      },
    ),
    extensionPolicy: createFakeExtensionPolicy({
      bundled: ['dolphy.bundled'],
      settings: { disabled: ['acme.off'], trusted: [], checkUpdates: true },
    }),
    extensionInstaller: installer,
  });

const watch = (t: TestEngine) => {
  const changes: ExtensionSettingChangeDto[] = [];
  t.engine.extensionHost.onSettingChanged((change) => changes.push(change));
  return changes;
};

const COUNT = 'acme.user.count';
const DEFAULTS = {
  'acme.user.fancy': false,
  'acme.user.name': 'abc',
  'acme.user.count': 3,
  'acme.user.ratio': 0.5,
  'acme.user.mode': 'a',
};

describe('extension setting values', () => {
  it('without saved values every setting has its default', async () => {
    const t = await open();
    expect(await t.engine.extensions.getSettingValues('acme.user')).toEqual(
      DEFAULTS,
    );
  });

  it('bundled extensions can have settings too', async () => {
    const t = await open();
    expect(
      await t.engine.extensions.getSettingValues('dolphy.bundled'),
    ).toEqual({ 'dolphy.bundled.flag': true });
    await t.engine.extensions.setSettingValue(
      'dolphy.bundled',
      'dolphy.bundled.flag',
      false,
    );
    expect(
      await t.engine.extensions.getSettingValues('dolphy.bundled'),
    ).toEqual({ 'dolphy.bundled.flag': false });
  });

  it('a valid value is returned, persisted, visible to the host and announced once', async () => {
    const t = await open();
    const changes = watch(t);
    const saved = await t.engine.extensions.setSettingValue(
      'acme.user',
      COUNT,
      7,
    );
    expect(saved).toEqual({ ...DEFAULTS, [COUNT]: 7 });
    expect(await t.engine.extensionHost.settings.all('acme.user')).toEqual(
      saved,
    );
    expect(await t.extensionDataStore.settings.all('acme.user')).toEqual({
      [COUNT]: 7,
    });
    expect(changes).toEqual([
      { extensionId: 'acme.user', id: COUNT, value: 7 },
    ]);
    expect(t.events).toContainEqual({
      type: 'settings-changed',
      scope: 'extensionValues',
      extensionId: 'acme.user',
    });
  });

  it('setting the same value again announces nothing', async () => {
    const t = await open();
    await t.engine.extensions.setSettingValue('acme.user', COUNT, 7);
    const changes = watch(t);
    const before = t.events.length;
    await t.engine.extensions.setSettingValue('acme.user', COUNT, 7);
    expect(changes).toEqual([]);
    expect(t.events).toHaveLength(before);
  });

  it.each([
    ['unknown setting', 'acme.user.nope', 1, 'unknown-setting'],
    [
      'a setting of another extension',
      'dolphy.bundled.flag',
      true,
      'unknown-setting',
    ],
    ['boolean given a string', 'acme.user.fancy', 'yes', 'type'],
    ['string given a number', 'acme.user.name', 5, 'type'],
    ['string over maxLength', 'acme.user.name', 'abcdef', 'max-length'],
    ['number given a string', COUNT, '5', 'type'],
    ['number given NaN', COUNT, Number.NaN, 'type'],
    [
      'number given Infinity',
      'acme.user.ratio',
      Number.POSITIVE_INFINITY,
      'type',
    ],
    ['non-integer for an integer setting', COUNT, 2.5, 'integer'],
    ['below min', COUNT, 0, 'range'],
    ['above max', COUNT, 11, 'range'],
    ['enum outside options', 'acme.user.mode', 'c', 'option'],
    ['enum given a number', 'acme.user.mode', 1, 'type'],
    ['null for any type', COUNT, null, 'type'],
  ] as const)(
    'rejects %s with INVALID_ARGUMENT/%s and stores nothing',
    async (_name, settingId, value, reason) => {
      const t = await open();
      const changes = watch(t);
      await expect(
        t.engine.extensions.setSettingValue('acme.user', settingId, value),
      ).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        details: { reason, extensionId: 'acme.user' },
      });
      expect(await t.extensionDataStore.settings.keys('acme.user')).toEqual([]);
      expect(changes).toEqual([]);
    },
  );

  it('accepts the boundaries: min, max, maxLength, a fractional value, every enum option', async () => {
    const t = await open();
    const set = (id: string, value: boolean | number | string) =>
      t.engine.extensions.setSettingValue('acme.user', id, value);
    expect((await set(COUNT, 1))[COUNT]).toBe(1);
    expect((await set(COUNT, 10))[COUNT]).toBe(10);
    expect((await set('acme.user.name', 'abcde'))['acme.user.name']).toBe(
      'abcde',
    );
    expect((await set('acme.user.name', ''))['acme.user.name']).toBe('');
    expect((await set('acme.user.ratio', 0.25))['acme.user.ratio']).toBe(0.25);
    expect((await set('acme.user.mode', 'b'))['acme.user.mode']).toBe('b');
  });

  it('a saved value that no longer fits the definition falls back to the default', async () => {
    const t = await open();
    await t.extensionDataStore.settings.set('acme.user', COUNT, 99); // граница сузилась после обновления
    await t.extensionDataStore.settings.set('acme.user', 'acme.user.gone', 1);
    expect(await t.engine.extensions.getSettingValues('acme.user')).toEqual(
      DEFAULTS,
    );
  });

  it('resetSettingValues restores defaults, forgets saved values and announces only what changed', async () => {
    const t = await open();
    await t.engine.extensions.setSettingValue('acme.user', COUNT, 7);
    await t.engine.extensions.setSettingValue(
      'acme.user',
      'acme.user.fancy',
      false,
    );
    const changes = watch(t);
    const reset = await t.engine.extensions.resetSettingValues('acme.user');
    expect(reset).toEqual(DEFAULTS);
    expect(await t.extensionDataStore.settings.keys('acme.user')).toEqual([]);
    expect(changes).toEqual([
      { extensionId: 'acme.user', id: COUNT, value: 3 },
    ]);
  });

  it('values of one extension do not leak into another', async () => {
    const t = await open();
    await t.engine.extensions.setSettingValue(
      'acme.user',
      'acme.user.fancy',
      true,
    );
    expect(
      await t.engine.extensions.getSettingValues('dolphy.bundled'),
    ).toEqual({ 'dolphy.bundled.flag': true });
  });

  it('refuses unknown, disabled and malformed ids', async () => {
    const t = await open();
    const call = (id: string) => t.engine.extensions.getSettingValues(id);
    await expect(call('acme.none')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(call('acme.off')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { reason: 'disabled' },
    });
    await expect(call('Not An Id')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(
      t.engine.extensions.setSettingValue('acme.off', 'x', 1),
    ).rejects.toMatchObject({ details: { reason: 'disabled' } });
    await expect(
      t.engine.extensions.resetSettingValues('acme.off'),
    ).rejects.toMatchObject({ details: { reason: 'disabled' } });
  });

  it('contributions() lists definitions of enabled extensions sorted by extension, in declared order inside one', async () => {
    const t = await open();
    const { settings } = await t.engine.extensions.contributions();
    expect(settings.map(({ id }) => id)).toEqual([
      'acme.user.fancy',
      'acme.user.name',
      'acme.user.count',
      'acme.user.ratio',
      'acme.user.mode',
      'dolphy.bundled.flag',
    ]);
    settings.length = 0; // копия: реестр не меняется
    expect((await t.engine.extensions.contributions()).settings).toHaveLength(
      6,
    );
  });
});

describe('extension data (host services)', () => {
  const storage = async () => {
    const t = await open();
    return { t, host: t.engine.extensionHost.storage };
  };

  it('stores any JSON per extension: get/set/delete/keys', async () => {
    const { host } = await storage();
    await host.set('acme.user', 'streak', { days: 3, list: [1, null] });
    await host.set('acme.user', 'a', 'x');
    await host.set('dolphy.bundled', 'streak', 'other');
    expect(await host.get('acme.user', 'streak')).toEqual({
      days: 3,
      list: [1, null],
    });
    expect(await host.get('dolphy.bundled', 'streak')).toBe('other');
    expect(await host.keys('acme.user')).toEqual(['a', 'streak']);
    expect(await host.delete('acme.user', 'a')).toBe(true);
    expect(await host.delete('acme.user', 'a')).toBe(false);
    expect(await host.get('acme.user', 'a')).toBeUndefined();
  });

  it('refuses unknown and disabled extensions on every call', async () => {
    const { t, host } = await storage();
    await t.extensionDataStore.storage.set('acme.off', 'k', 1); // данные остались с прошлых включений
    for (const id of ['acme.none', 'acme.off']) {
      const code = id === 'acme.none' ? 'NOT_FOUND' : 'INVALID_ARGUMENT';
      await expect(host.get(id, 'k')).rejects.toMatchObject({ code });
      await expect(host.set(id, 'k', 2)).rejects.toMatchObject({ code });
      await expect(host.delete(id, 'k')).rejects.toMatchObject({ code });
      await expect(host.keys(id)).rejects.toMatchObject({ code });
      await expect(
        t.engine.extensionHost.settings.all(id),
      ).rejects.toMatchObject({ code });
    }
    expect(await t.extensionDataStore.storage.get('acme.off', 'k')).toBe(1);
  });

  it('a disabled extension is refused as soon as policy says so', async () => {
    const { t, host } = await storage();
    await host.set('acme.user', 'k', 1);
    await t.engine.extensions.setEnabled('acme.user', false);
    await expect(host.get('acme.user', 'k')).rejects.toMatchObject({
      details: { reason: 'disabled' },
    });
    await t.engine.extensions.setEnabled('acme.user', true);
    expect(await host.get('acme.user', 'k')).toBe(1); // отключение данные не трогает
  });

  it('quota errors carry the kind and the limit and change nothing', async () => {
    const { t, host } = await storage();
    await host.set('acme.user', 'k', 'keep');
    await expect(
      host.set('acme.user', 'k'.repeat(129), 1),
    ).rejects.toMatchObject({
      code: 'EXTENSION_STORAGE_QUOTA',
      retryable: false,
      details: {
        extensionId: 'acme.user',
        kind: 'key-length',
        limit: EXTENSION_STORAGE_LIMITS.keyLength,
      },
    });
    await expect(
      host.set(
        'acme.user',
        'k',
        'x'.repeat(EXTENSION_STORAGE_LIMITS.valueBytes),
      ),
    ).rejects.toMatchObject({
      details: {
        kind: 'value-size',
        limit: EXTENSION_STORAGE_LIMITS.valueBytes,
      },
    });
    expect(await host.get('acme.user', 'k')).toBe('keep');
    expect(await t.extensionDataStore.storage.keys('acme.user')).toEqual(['k']);
  });

  it('rejects a key that is not a string and a value that is not JSON', async () => {
    const { host } = await storage();
    await expect(
      host.get('acme.user', 1 as unknown as string),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      host.set('acme.user', 'k', undefined as never),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(host.set('acme.user', '', 1)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  it('refuses everything once the engine is closed', async () => {
    const { t, host } = await storage();
    await t.engine.close();
    await expect(host.get('acme.user', 'k')).rejects.toMatchObject({
      code: 'ENGINE_CLOSED',
    });
  });

  it('host storage is independent of the setting values of the same extension', async () => {
    const { t, host } = await storage();
    await host.set('acme.user', COUNT, 'code data');
    await t.engine.extensions.setSettingValue('acme.user', COUNT, 5);
    expect(await host.get('acme.user', COUNT)).toBe('code data');
    expect(
      (await t.engine.extensionHost.settings.all('acme.user'))[COUNT],
    ).toBe(5);
  });
});

describe('extension data lifecycle', () => {
  it('dataUsage reports storage and setting values separately', async () => {
    const t = await open();
    await t.engine.extensionHost.storage.set('acme.user', 'k', 'я'); // 4 байта
    await t.engine.extensions.setSettingValue('acme.user', COUNT, 7);
    expect(await t.engine.extensions.dataUsage('acme.user')).toEqual({
      storage: { keys: 1, bytes: 4 },
      settings: { keys: 1, bytes: 1 },
    });
    expect(await t.engine.extensions.dataUsage('acme.never')).toEqual({
      storage: { keys: 0, bytes: 0 },
      settings: { keys: 0, bytes: 0 },
    });
    await expect(t.engine.extensions.dataUsage('Bad Id')).rejects.toMatchObject(
      {
        code: 'INVALID_ARGUMENT',
      },
    );
  });

  it('clearData empties storage, resets settings, tells the running extension and the window', async () => {
    const t = await open();
    await t.engine.extensionHost.storage.set('acme.user', 'k', 1);
    await t.engine.extensions.setSettingValue('acme.user', COUNT, 7);
    await t.engine.extensionHost.storage.set('dolphy.bundled', 'k', 'safe');
    const changes = watch(t);
    await t.engine.extensions.clearData('acme.user');
    expect(await t.engine.extensionHost.storage.keys('acme.user')).toEqual([]);
    expect(await t.engine.extensions.getSettingValues('acme.user')).toEqual(
      DEFAULTS,
    );
    expect(changes).toEqual([
      { extensionId: 'acme.user', id: COUNT, value: 3 },
    ]);
    expect(
      await t.engine.extensionHost.storage.get('dolphy.bundled', 'k'),
    ).toBe('safe');
    expect(t.events.at(-1)).toEqual({
      type: 'settings-changed',
      scope: 'extensionValues',
      extensionId: 'acme.user',
    });
  });

  it('clearData works for an extension that is gone but left data behind', async () => {
    const t = await open();
    await t.extensionDataStore.storage.set('acme.gone', 'k', 1);
    await t.engine.extensions.clearData('acme.gone');
    expect(await t.extensionDataStore.storage.keys('acme.gone')).toEqual([]);
  });

  it('uninstall keeps the data by default and removes it with removeData', async () => {
    const t = await open();
    await t.engine.extensionHost.storage.set('acme.user', 'k', 1);
    await t.engine.extensions.setSettingValue('acme.user', COUNT, 7);
    await t.engine.extensions.uninstall('acme.user');
    expect(await t.extensionDataStore.storage.keys('acme.user')).toEqual(['k']);
    expect(await t.extensionDataStore.settings.keys('acme.user')).toEqual([
      COUNT,
    ]);
    await t.engine.extensions.uninstall('acme.user', { removeData: false });
    expect(await t.extensionDataStore.storage.keys('acme.user')).toEqual(['k']);
    await t.engine.extensions.uninstall('acme.user', { removeData: true });
    expect(await t.extensionDataStore.storage.keys('acme.user')).toEqual([]);
    expect(await t.extensionDataStore.settings.keys('acme.user')).toEqual([]);
  });

  it('a malformed removeData rejects the whole command: the extension stays installed', async () => {
    const installer = createFakeExtensionInstaller();
    const t = await open(installer);
    await expect(
      t.engine.extensions.uninstall('acme.user', {
        removeData: 'yes' as unknown as boolean,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(installer.calls.map(({ method }) => method)).not.toContain(
      'uninstall',
    );
  });

  it('a failed uninstall removes no data', async () => {
    const t = await createTestEngine({
      extensionRegistry: createFakeExtensionRegistry([ext('acme.user')]),
      extensionInstaller: createFakeExtensionInstaller({
        handlers: {
          uninstall: () => {
            throw new Error('disk is read-only');
          },
        },
      }),
    });
    await t.extensionDataStore.storage.set('acme.user', 'k', 1);
    await expect(
      t.engine.extensions.uninstall('acme.user', { removeData: true }),
    ).rejects.toBeDefined();
    expect(await t.extensionDataStore.storage.keys('acme.user')).toEqual(['k']);
  });
});
