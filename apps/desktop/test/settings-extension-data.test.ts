import { effectScope, shallowRef } from 'vue';
import { describe, expect, it } from 'vitest';
import type {
  ExtensionDataUsageDto,
  ExtensionInfoDto,
  LearningEngine,
} from '@dolphy-app/engine-contract';
import {
  dataTotals,
  hasData,
  useExtensionData,
} from '@/pages/settings/model/extension-data.ts';
import {
  FakeEngineError,
  createEventBus,
  extensionInfo,
  flush,
} from './support/extensions-fakes.ts';

const usage = (
  storage: [number, number],
  settings: [number, number] = [0, 0],
): ExtensionDataUsageDto => ({
  storage: { keys: storage[0], bytes: storage[1] },
  settings: { keys: settings[0], bytes: settings[1] },
});

const NO_DATA = usage([0, 0]);

const setup = (
  initial: ExtensionInfoDto[],
  data: Record<string, ExtensionDataUsageDto | Error>,
  options: { clearError?: Error } = {},
) => {
  const bus = createEventBus();
  const asked: string[] = [];
  const cleared: string[] = [];
  const engine = {
    subscribe: bus.subscribe,
    extensions: {
      dataUsage: async (id: string) => {
        asked.push(id);
        const result = data[id];
        if (result === undefined) return NO_DATA;
        if (result instanceof Error) throw result;
        return result;
      },
      clearData: async (id: string) => {
        if (options.clearError) throw options.clearError;
        cleared.push(id);
        data[id] = NO_DATA;
      },
    },
  } as unknown as LearningEngine;
  const items = shallowRef(initial);
  const scope = effectScope();
  const model = scope.run(() => useExtensionData(engine, items))!;
  return { model, items, bus, asked, cleared, scope };
};

describe('данные расширений: итоги', () => {
  it('хранилище и настройки складываются; данные есть при любом занятом ключе', () => {
    expect(dataTotals(usage([2, 100], [1, 20]))).toEqual({
      keys: 3,
      bytes: 120,
    });
    expect(hasData(usage([0, 0], [1, 5]))).toBe(true);
    expect(hasData(usage([1, 9]))).toBe(true);
    expect(hasData(NO_DATA)).toBe(false);
    expect(hasData(undefined)).toBe(false);
  });
});

describe('данные расширений: использование', () => {
  it('читается у загруженных и отключённых; перекрытые и некорректные пропускаются', async () => {
    const { model, asked } = setup(
      [
        extensionInfo('acme.a'),
        extensionInfo('acme.b', { state: 'disabled' }),
        extensionInfo('acme.c', { state: 'overridden' }),
        extensionInfo('acme.d', { state: 'invalid' }),
      ],
      { 'acme.a': usage([2, 40]), 'acme.b': usage([0, 0], [1, 8]) },
    );
    await flush();

    expect([...model.usage.value.keys()].sort()).toEqual(['acme.a', 'acme.b']);
    expect(asked.sort()).toEqual(['acme.a', 'acme.b']);
    expect(model.usage.value.get('acme.a')).toEqual(usage([2, 40]));
  });

  it('у расширения без данных запись есть, но данных нет', async () => {
    const { model } = setup([extensionInfo('acme.a')], {});
    await flush();
    expect(hasData(model.usage.value.get('acme.a'))).toBe(false);
  });

  it('сбой чтения одного расширения не прячет остальные', async () => {
    const { model } = setup(
      [extensionInfo('acme.a'), extensionInfo('acme.b')],
      { 'acme.a': new Error('boom'), 'acme.b': usage([1, 3]) },
    );
    await flush();
    expect([...model.usage.value.keys()]).toEqual(['acme.b']);
  });

  it('перечитывается при смене списка и при изменении значений настроек', async () => {
    const { model, items, bus, asked } = setup([extensionInfo('acme.a')], {
      'acme.a': usage([1, 3]),
      'acme.b': usage([5, 50]),
    });
    await flush();
    expect(asked).toEqual(['acme.a']);

    items.value = [extensionInfo('acme.a'), extensionInfo('acme.b')];
    await flush();
    expect(model.usage.value.get('acme.b')).toEqual(usage([5, 50]));

    bus.emit({
      type: 'settings-changed',
      scope: 'extensionValues',
      extensionId: 'acme.a',
    });
    await flush();
    expect(asked.filter((id) => id === 'acme.a')).toHaveLength(3);

    bus.emit({ type: 'settings-changed', scope: 'ui' });
    await flush();
    expect(asked.filter((id) => id === 'acme.a')).toHaveLength(3);
  });
});

describe('данные расширений: очистка', () => {
  it('стирает данные расширения и обновляет цифры', async () => {
    const { model, cleared } = setup([extensionInfo('acme.a')], {
      'acme.a': usage([4, 90], [1, 10]),
    });
    await flush();
    expect(hasData(model.usage.value.get('acme.a'))).toBe(true);

    expect(await model.clear('acme.a')).toBe(true);

    expect(cleared).toEqual(['acme.a']);
    expect(hasData(model.usage.value.get('acme.a'))).toBe(false);
    expect(model.clearing.value).toBeNull();
    expect(model.clearError.value).toBeNull();
  });

  it('отказ движка показывается, данные остаются, кнопка освобождается', async () => {
    const { model } = setup(
      [extensionInfo('acme.a')],
      { 'acme.a': usage([4, 90]) },
      { clearError: new FakeEngineError('INTERNAL', 'disk is full') },
    );
    await flush();

    expect(await model.clear('acme.a')).toBe(false);

    expect(model.clearError.value).toBe('disk is full');
    expect(hasData(model.usage.value.get('acme.a'))).toBe(true);
    expect(model.clearing.value).toBeNull();
  });

  it('пока идёт очистка, вторая не начинается', async () => {
    const { model, cleared } = setup([extensionInfo('acme.a')], {
      'acme.a': usage([1, 1]),
    });
    await flush();
    await Promise.all([model.clear('acme.a'), model.clear('acme.a')]);
    expect(cleared).toEqual(['acme.a']);
  });

  it('после закрытия подписка снимается', async () => {
    const { bus, scope } = setup([extensionInfo('acme.a')], {});
    await flush();
    expect(bus.count()).toBe(1);
    scope.stop();
    expect(bus.count()).toBe(0);
  });
});
