import { describe, expect, it, vi } from 'vitest';
import type {
  ExtensionUpdateDto,
  LearningEngine,
} from '@dolphy-app/engine-contract';
import {
  createExtensionUpdatesStore,
  updatesBadgeText,
} from '@/shared/api/engine/extension-updates.ts';
import {
  catalogVersion,
  createEventBus,
  flush,
} from './support/extensions-fakes.ts';

const update = (id: string): ExtensionUpdateDto => ({
  id,
  name: id,
  installed: '1.0.0',
  available: catalogVersion('1.1.0'),
});

interface Call {
  resolve(updates: ExtensionUpdateDto[]): void;
  reject(error: Error): void;
}

/** Каждый `updates()` ждёт, пока тест его не завершит. */
const setup = () => {
  const bus = createEventBus();
  const calls: Call[] = [];
  const engine = {
    subscribe: bus.subscribe,
    extensions: {
      updates: () =>
        new Promise<ExtensionUpdateDto[]>((resolve, reject) => {
          calls.push({ resolve, reject });
        }),
    },
  } as unknown as LearningEngine;
  const store = createExtensionUpdatesStore(engine);
  return { store, bus, calls };
};

describe('createExtensionUpdatesStore', () => {
  it('читает обновления при создании и публикует число', async () => {
    const { store, calls } = setup();
    expect(calls).toHaveLength(1);
    expect(store.count.value).toBe(0);
    calls[0]?.resolve([update('a.one'), update('a.two')]);
    await flush();
    expect(store.count.value).toBe(2);
    expect(store.updates.value.map(({ id }) => id)).toEqual(['a.one', 'a.two']);
  });

  it('extensions-changed перечитывает: значок появляется после стартовой проверки и исчезает после обновления', async () => {
    const { store, bus, calls } = setup();
    calls[0]?.resolve([]);
    await flush();
    expect(store.count.value).toBe(0);

    bus.emit({ type: 'extensions-changed' });
    await flush();
    expect(calls).toHaveLength(2);
    calls[1]?.resolve([update('a.one')]);
    await flush();
    expect(store.count.value).toBe(1);

    bus.emit({ type: 'extensions-changed' });
    await flush();
    calls[2]?.resolve([]);
    await flush();
    expect(store.count.value).toBe(0);
  });

  it('другие события не вызывают чтения', async () => {
    const { bus, calls } = setup();
    calls[0]?.resolve([]);
    await flush();
    bus.emit({ type: 'contributions-changed', generation: 1 });
    await flush();
    expect(calls).toHaveLength(1);
  });

  it('ответ устаревшего запроса отбрасывается', async () => {
    const { store, bus, calls } = setup();
    calls[0]?.resolve([]);
    await flush();
    bus.emit({ type: 'extensions-changed' });
    await flush();
    bus.emit({ type: 'extensions-changed' });
    await flush();
    expect(calls).toHaveLength(3);
    calls[2]?.resolve([]);
    await flush();
    calls[1]?.resolve([update('a.stale')]);
    await flush();
    expect(store.count.value).toBe(0);
  });

  it('переподключение читает заново, ответ прежнего порта отбрасывается', async () => {
    const { store, calls } = setup();
    calls[0]?.resolve([update('a.one')]);
    await flush();
    const pending = store.reconnected();
    expect(calls).toHaveLength(2);
    // ответ прежнего порта (запрос, начатый до перезапуска) опаздывает
    calls[0]?.resolve([update('a.old'), update('a.older')]);
    calls[1]?.resolve([]);
    await pending;
    expect(store.count.value).toBe(0);
  });

  it('сбой чтения оставляет прежнее число и пишет в консоль', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { store, bus, calls } = setup();
      calls[0]?.resolve([update('a.one')]);
      await flush();
      bus.emit({ type: 'extensions-changed' });
      await flush();
      calls[1]?.reject(new Error('down'));
      await flush();
      expect(store.count.value).toBe(1);
      expect(error).toHaveBeenCalledTimes(1);
    } finally {
      error.mockRestore();
    }
  });

  it('после dispose события не читаются', async () => {
    const { store, bus, calls } = setup();
    calls[0]?.resolve([]);
    await flush();
    store.dispose();
    bus.emit({ type: 'extensions-changed' });
    await flush();
    expect(calls).toHaveLength(1);
    expect(bus.count()).toBe(0);
  });
});

describe('updatesBadgeText', () => {
  it('нет обновлений — нет значка; от 9 — «9+»', () => {
    expect(updatesBadgeText(0)).toBeNull();
    expect(updatesBadgeText(1)).toBe('1');
    expect(updatesBadgeText(8)).toBe('8');
    expect(updatesBadgeText(9)).toBe('9+');
    expect(updatesBadgeText(42)).toBe('9+');
  });
});
