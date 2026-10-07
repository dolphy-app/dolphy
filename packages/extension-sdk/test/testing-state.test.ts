import { describe, expect, it, vi } from 'vitest';
import {
  EXTENSION_SECRET_LIMITS,
  EXTENSION_STORAGE_LIMITS,
  SecretsUnavailableError,
  StorageQuotaError,
  defineExtension,
  type ExtensionContext,
  type SettingContribution,
} from '../src/index.ts';
import {
  createMemoryEvents,
  createMemorySecrets,
  createMemorySettings,
  createMemoryStorage,
  loadEvents,
  loadExerciseType,
} from '../src/testing.ts';

const LIMITS = EXTENSION_STORAGE_LIMITS;

const quotaOf = async (
  action: Promise<unknown>,
): Promise<StorageQuotaError> => {
  const error = await action.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(StorageQuotaError);
  return error as StorageQuotaError;
};

describe('createMemoryStorage', () => {
  it('stores JSON, returns copies, keys in code point order', async () => {
    const storage = createMemoryStorage();
    const value = { list: [1, 2], nested: { ok: true } };

    await storage.set('b', value);
    await storage.set('a', null);
    await storage.set('\u{1F600}', 1); // an astral character above U+FFFF

    const got = await storage.get<typeof value>('b');
    expect(got).toEqual(value);
    expect(got).not.toBe(value);
    expect(await storage.get('missing')).toBeUndefined();
    expect(await storage.keys()).toEqual(['a', 'b', '\u{1F600}']);
    expect(await storage.delete('a')).toBe(true);
    expect(await storage.delete('a')).toBe(false);
  });

  it('non-JSON and an empty key are rejected', async () => {
    const storage = createMemoryStorage();
    await expect(storage.set('', 1)).rejects.toThrow(/non-empty/);
    await expect(storage.set('k', undefined as never)).rejects.toThrow(/JSON/);
    expect(await storage.keys()).toEqual([]);
  });

  it.each([
    ['key-length', LIMITS.keyLength, 'x'.repeat(LIMITS.keyLength + 1), 1],
    ['value-size', LIMITS.valueBytes, 'k', 'x'.repeat(LIMITS.valueBytes)],
  ])(
    '%s: StorageQuotaError with limit, no write happens',
    async (kind, limit, key, value) => {
      const storage = createMemoryStorage();
      await storage.set('kept', 1);

      const error = await quotaOf(storage.set(key, value as never));

      expect(error).toMatchObject({ name: 'StorageQuotaError', kind, limit });
      expect(await storage.keys()).toEqual(['kept']);
    },
  );

  it('key-count: the 257th key is rejected, overwriting an existing one is allowed', async () => {
    const storage = createMemoryStorage();
    for (let i = 0; i < LIMITS.keys; i++) await storage.set(`k${i}`, i);

    const error = await quotaOf(storage.set('one-more', 1));
    await storage.set('k0', 'rewritten');

    expect(error).toMatchObject({ kind: 'key-count', limit: LIMITS.keys });
    expect(await storage.get('k0')).toBe('rewritten');
    expect(await storage.keys()).toHaveLength(LIMITS.keys);
  });

  it('total-size: the total excludes the old value of the key being overwritten', async () => {
    const storage = createMemoryStorage();
    const big = 'x'.repeat(LIMITS.valueBytes - 2); // JSON text: valueBytes bytes including quotes
    const fits = LIMITS.totalBytes / LIMITS.valueBytes; // this many values exactly fill the storage
    for (let i = 0; i < fits; i++) await storage.set(`big${i}`, big);

    const error = await quotaOf(storage.set('extra', 1));
    await storage.set('big0', big); // same length in place of the old value — allowed

    expect(error).toMatchObject({
      kind: 'total-size',
      limit: LIMITS.totalBytes,
    });
    expect(await storage.get('extra')).toBeUndefined();
  });
});

const definitions: SettingContribution[] = [
  { id: 'a.on', type: 'boolean', label: 'On', default: false },
  { id: 'a.name', type: 'string', label: 'Name', default: 'x', maxLength: 3 },
  {
    id: 'a.size',
    type: 'number',
    label: 'Size',
    default: 2,
    min: 1,
    max: 5,
    integer: true,
  },
  {
    id: 'a.mode',
    type: 'enum',
    label: 'Mode',
    default: 'fast',
    options: [
      { value: 'fast', label: 'Fast' },
      { value: 'slow', label: 'Slow' },
    ],
  },
];

const rich: SettingContribution[] = [
  { id: 'a.note', type: 'text', label: 'Note', default: 'x\ny', maxLength: 5 },
  { id: 'a.tint', type: 'color', label: 'Tint', default: '#AA00bb' },
  {
    id: 'a.tags',
    type: 'list',
    label: 'Tags',
    default: ['one'],
    maxItems: 2,
    itemMaxLength: 4,
  },
];

describe('createMemorySecrets', () => {
  const limits = EXTENSION_SECRET_LIMITS;

  it('stores strings; a missing key is undefined; delete reports whether the key existed', async () => {
    const secrets = createMemorySecrets();
    await secrets.set('token', 'сек-ret');
    await secrets.set('empty', '');
    expect(await secrets.get('token')).toBe('сек-ret');
    expect(await secrets.get('empty')).toBe('');
    expect(await secrets.get('missing')).toBeUndefined();
    expect(await secrets.delete('token')).toBe(true);
    expect(await secrets.delete('token')).toBe(false);
  });

  it('limits: key 128, value 4 KiB in bytes, 32 keys; a rejected write changes nothing', async () => {
    const secrets = createMemorySecrets();
    await secrets.set('k'.repeat(limits.keyLength), 'v');
    expect(
      (await quotaOf(secrets.set('k'.repeat(limits.keyLength + 1), 'v'))).kind,
    ).toBe('key-length');
    await secrets.set('big', 'я'.repeat(limits.valueBytes / 2));
    const tooBig = await quotaOf(
      secrets.set('big', 'я'.repeat(limits.valueBytes / 2 + 1)),
    );
    expect([tooBig.kind, tooBig.limit]).toEqual([
      'value-size',
      limits.valueBytes,
    ]);
    expect(await secrets.get('big')).toBe('я'.repeat(limits.valueBytes / 2));
    for (let i = 2; i < limits.keys; i++) await secrets.set(`k${i}`, 'v');
    const full = await quotaOf(secrets.set('extra', 'v'));
    expect([full.kind, full.limit]).toEqual(['key-count', limits.keys]);
    await secrets.set('big', 'replaced'); // overwriting does not need a new key
    expect(await secrets.get('big')).toBe('replaced');
  });

  it('without a key store set and get of an existing key throw; get of a missing key and delete work', async () => {
    const secrets = createMemorySecrets();
    await secrets.set('token', 'x');
    secrets.setAvailable(false);
    await expect(secrets.set('new', 'y')).rejects.toBeInstanceOf(
      SecretsUnavailableError,
    );
    const error = await secrets.get('token').catch((e: unknown) => e);
    expect(error).toMatchObject({
      name: 'SecretsUnavailable',
      code: 'SECRETS_UNAVAILABLE',
    });
    expect(await secrets.get('new')).toBeUndefined();
    expect(await secrets.delete('token')).toBe(true);
    secrets.setAvailable(true);
    await secrets.set('token', 'again');
    expect(await secrets.get('token')).toBe('again');
    await expect(
      createMemorySecrets({ available: false }).set('k', 'v'),
    ).rejects.toBeInstanceOf(SecretsUnavailableError);
  });

  it('loadEvents hands the same secrets to the module and returns them', async () => {
    const loaded = await loadEvents({
      activate: async (ctx) => {
        await ctx.secrets.set('token', 'from-module');
      },
    });
    expect(await loaded.secrets.get('token')).toBe('from-module');
  });
});

describe('createMemorySettings: text, color and list', () => {
  it('a color is stored in lower case, a list is handed out as a copy', () => {
    const settings = createMemorySettings(rich);
    expect(settings.get('a.tint')).toBe('#aa00bb');
    (settings.get('a.tags') as string[]).push('mutated');
    expect(settings.get('a.tags')).toEqual(['one']);
  });

  it('set changes a list, equal lists are not a change, a color change is case-insensitive', async () => {
    const settings = createMemorySettings(rich);
    const changes: unknown[] = [];
    settings.onDidChange((change) => changes.push(change));
    await settings.set('a.tags', ['one']);
    await settings.set('a.tags', ['two', 'one']);
    await settings.set('a.tint', '#AA00BB');
    await settings.set('a.tint', '#00FF00');
    expect(changes).toEqual([
      { id: 'a.tags', value: ['two', 'one'] },
      { id: 'a.tint', value: '#00ff00' },
    ]);
  });

  it.each([
    ['a.note', 'abcdef', /longer than 5/],
    ['a.note', 3, /string/],
    ['a.tint', '#abc', /color/],
    ['a.tint', 'red', /color/],
    ['a.tags', 'one', /array of strings/],
    ['a.tags', ['one', 2], /array of strings/],
    ['a.tags', ['a', 'b', 'c'], /more than 2 items/],
    ['a.tags', ['abcde'], /longer than 4/],
  ])('%s ← %j is rejected', async (id, value, message) => {
    const settings = createMemorySettings(rich);
    await expect(settings.set(id, value as never)).rejects.toThrow(message);
  });
});

describe('createMemorySettings', () => {
  it('get returns the default or the user value; an unknown id throws', () => {
    const settings = createMemorySettings(definitions, { 'a.size': 4 });

    expect(settings.get('a.on')).toBe(false);
    expect(settings.get('a.size')).toBe(4);
    expect(() => settings.get('a.nope')).toThrow(/not declared/);
  });

  it('set validates the value against the definition and calls onDidChange only on change', async () => {
    const settings = createMemorySettings(definitions);
    const changes: unknown[] = [];
    const subscription = settings.onDidChange((change) => changes.push(change));

    await settings.set('a.mode', 'slow');
    await settings.set('a.mode', 'slow');
    await subscription.dispose();
    await settings.set('a.on', true);

    expect(changes).toEqual([{ id: 'a.mode', value: 'slow' }]);
    expect(settings.get('a.on')).toBe(true);
  });

  it.each([
    ['a.on', 'yes', /boolean/],
    ['a.name', 'abcd', /longer than 3/],
    ['a.size', 2.5, /integer/],
    ['a.size', 0, /less than 1/],
    ['a.size', 6, /greater than 5/],
    ['a.mode', 'medium', /options/],
    ['a.nope', 1, /not declared/],
  ])('%s ← %j is rejected', async (id, value, message) => {
    const settings = createMemorySettings(definitions);
    await expect(settings.set(id, value as never)).rejects.toThrow(message);
    expect(() =>
      createMemorySettings(definitions, { [id]: value as never }),
    ).toThrow(message);
  });

  it('a handler failure rejects set; the value is already changed', async () => {
    const settings = createMemorySettings(definitions);
    settings.onDidChange(() => {
      throw new Error('handler bug');
    });

    await expect(settings.set('a.on', true)).rejects.toThrow('handler bug');
    expect(settings.get('a.on')).toBe(true);
  });
});

describe('createMemoryEvents', () => {
  it('emit delivers to the subscriber and awaits it; without a subscription it skips', async () => {
    const events = createMemoryEvents();
    const order: string[] = [];
    events.on('attempt.closed', async ({ exerciseId }) => {
      await Promise.resolve();
      order.push(exerciseId);
    });

    await events.emit('session.started', { sessionId: 's', at: 1 });
    await events.emit('attempt.closed', {
      exerciseId: 'e1',
      courseId: 'c',
      lessonId: 'l',
      grade: 5,
      outcome: 'passed',
      source: 'self',
      at: 1,
    });

    expect(order).toEqual(['e1']);
  });

  it('subscription is checked as in the host: declaration, one per event', () => {
    const events = createMemoryEvents({ declared: ['session.started'] });
    expect(() => events.on('attempt.closed', vi.fn())).toThrow(/not declared/);
    const first = events.on('session.started', vi.fn());
    expect(() => events.on('session.started', vi.fn())).toThrow(/already/);
    void first.dispose();
    expect(() => events.on('session.started', vi.fn())).not.toThrow();
  });

  it('a handler failure rejects emit', async () => {
    const events = createMemoryEvents();
    events.on('session.finished', () => {
      throw new Error('handler bug');
    });
    await expect(
      events.emit('session.finished', { sessionId: 's', at: 1 }),
    ).rejects.toThrow('handler bug');
  });
});

describe('loadEvents', () => {
  it('an extension with defineExtension({ events }) receives the event and writes to the test storage and settings', async () => {
    let context: ExtensionContext | null = null;
    const module = defineExtension({
      activate: (ctx) => {
        context = ctx;
        ctx.settings.onDidChange(({ id, value }) =>
          ctx.storage.set('changed', `${id}=${String(value)}`),
        );
      },
      events: {
        'attempt.closed': async ({ grade }) => {
          await (context as ExtensionContext | null)?.storage.set(
            'last-grade',
            grade,
          );
        },
      },
    });
    const loaded = await loadEvents(module, {
      settings: definitions,
      declared: ['attempt.closed'],
    });

    await loaded.emit('attempt.closed', {
      exerciseId: 'e',
      courseId: 'c',
      lessonId: 'l',
      grade: 3,
      outcome: 'failed',
      source: 'runner',
      at: 5,
    });
    await loaded.settings.set('a.on', true);

    expect(await loaded.storage.get('last-grade')).toBe(3);
    expect(await loaded.storage.get('changed')).toBe('a.on=true');
    await loaded.dispose();
  });

  it('other loaders provide memory too: an exercise-kind extension sees ctx.storage', async () => {
    const module = defineExtension({
      exerciseTypes: {
        'a.count': {
          project: () => null,
          grade: () => ({ outcome: 'passed' }),
        },
      },
      activate: async (ctx) => {
        await ctx.storage.set('activated', true);
      },
    });
    const storage = createMemoryStorage();

    await loadExerciseType(module, 'a.count', { storage });

    expect(await storage.get('activated')).toBe(true);
  });
});
