import { describe, expect, it, vi } from 'vitest';
import {
  EXTENSION_STORAGE_LIMITS,
  PermissionError,
  StorageQuotaError,
  defineExtension,
  type ExtensionContext,
  type SettingContribution,
} from '../src/index.ts';
import {
  createMemoryEvents,
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
  it('хранит JSON, отдаёт копии, ключи по порядку кодовых точек', async () => {
    const storage = createMemoryStorage();
    const value = { list: [1, 2], nested: { ok: true } };

    await storage.set('b', value);
    await storage.set('a', null);
    await storage.set('\u{1F600}', 1); // астральный символ больше U+FFFF

    const got = await storage.get<typeof value>('b');
    expect(got).toEqual(value);
    expect(got).not.toBe(value);
    expect(await storage.get('missing')).toBeUndefined();
    expect(await storage.keys()).toEqual(['a', 'b', '\u{1F600}']);
    expect(await storage.delete('a')).toBe(true);
    expect(await storage.delete('a')).toBe(false);
  });

  it('не JSON и пустой ключ отклоняются', async () => {
    const storage = createMemoryStorage();
    await expect(storage.set('', 1)).rejects.toThrow(/non-empty/);
    await expect(storage.set('k', undefined as never)).rejects.toThrow(/JSON/);
    expect(await storage.keys()).toEqual([]);
  });

  it.each([
    ['key-length', LIMITS.keyLength, 'x'.repeat(LIMITS.keyLength + 1), 1],
    ['value-size', LIMITS.valueBytes, 'k', 'x'.repeat(LIMITS.valueBytes)],
  ])(
    '%s: StorageQuotaError с limit, запись не происходит',
    async (kind, limit, key, value) => {
      const storage = createMemoryStorage();
      await storage.set('kept', 1);

      const error = await quotaOf(storage.set(key, value as never));

      expect(error).toMatchObject({ name: 'StorageQuotaError', kind, limit });
      expect(await storage.keys()).toEqual(['kept']);
    },
  );

  it('key-count: 257-й ключ отклоняется, перезапись существующего допустима', async () => {
    const storage = createMemoryStorage();
    for (let i = 0; i < LIMITS.keys; i++) await storage.set(`k${i}`, i);

    const error = await quotaOf(storage.set('one-more', 1));
    await storage.set('k0', 'rewritten');

    expect(error).toMatchObject({ kind: 'key-count', limit: LIMITS.keys });
    expect(await storage.get('k0')).toBe('rewritten');
    expect(await storage.keys()).toHaveLength(LIMITS.keys);
  });

  it('total-size: общий объём считается без старого значения перезаписываемого ключа', async () => {
    const storage = createMemoryStorage();
    const big = 'x'.repeat(LIMITS.valueBytes - 2); // JSON-текст: valueBytes байт с кавычками
    const fits = LIMITS.totalBytes / LIMITS.valueBytes; // столько значений ровно заполняют хранилище
    for (let i = 0; i < fits; i++) await storage.set(`big${i}`, big);

    const error = await quotaOf(storage.set('extra', 1));
    await storage.set('big0', big); // та же длина вместо старого значения — допустимо

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

describe('createMemorySettings', () => {
  it('get отдаёт default или значение пользователя; неизвестный id бросает', () => {
    const settings = createMemorySettings(definitions, { 'a.size': 4 });

    expect(settings.get('a.on')).toBe(false);
    expect(settings.get('a.size')).toBe(4);
    expect(() => settings.get('a.nope')).toThrow(/not declared/);
  });

  it('set проверяет значение по определению и зовёт onDidChange только при изменении', async () => {
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
  ])('%s ← %j отклоняется', async (id, value, message) => {
    const settings = createMemorySettings(definitions);
    await expect(settings.set(id, value as never)).rejects.toThrow(message);
    expect(() =>
      createMemorySettings(definitions, { [id]: value as never }),
    ).toThrow(message);
  });

  it('сбой обработчика отклоняет set, значение уже изменено', async () => {
    const settings = createMemorySettings(definitions);
    settings.onDidChange(() => {
      throw new Error('handler bug');
    });

    await expect(settings.set('a.on', true)).rejects.toThrow('handler bug');
    expect(settings.get('a.on')).toBe(true);
  });
});

describe('createMemoryEvents', () => {
  it('emit доставляет подписчику и ждёт его; без подписки пропускает', async () => {
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

  it('подписка проверяется как в хосте: разрешение, объявление, одна на событие', () => {
    expect(() =>
      createMemoryEvents({ permitted: false }).on('session.started', vi.fn()),
    ).toThrow(PermissionError);
    const events = createMemoryEvents({ declared: ['session.started'] });
    expect(() => events.on('attempt.closed', vi.fn())).toThrow(/not declared/);
    const first = events.on('session.started', vi.fn());
    expect(() => events.on('session.started', vi.fn())).toThrow(/already/);
    void first.dispose();
    expect(() => events.on('session.started', vi.fn())).not.toThrow();
  });

  it('сбой обработчика отклоняет emit', async () => {
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
  it('расширение с defineExtension({ events }) получает событие и пишет в хранилище и настройки теста', async () => {
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

  it('другие загрузчики тоже дают памяти: расширение вида заданий видит ctx.storage', async () => {
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
