import { effectScope } from 'vue';
import { describe, expect, it } from 'vitest';
import type {
  CatalogSourceDto,
  LearningEngine,
} from '@dolphy-app/engine-contract';
import {
  catalogUrlRejection,
  isFromAnotherCatalog,
} from '@/pages/settings/lib/catalog-source.ts';
import { useCatalogSource } from '@/pages/settings/model/catalog-source.ts';
import {
  FakeEngineError,
  createEventBus,
  flush,
} from './support/extensions-fakes.ts';

const DEFAULT = 'https://dolphy-app.github.io/dolphy-extensions/index.json';
const OWN = 'https://own.test/catalog/index.json';

/** Движок с одним адресом: `setCatalogUrl` принимает всё, кроме значений из `reject`. */
const setup = (
  initial: Partial<CatalogSourceDto> = {},
  reject: Record<string, string> = {},
) => {
  const bus = createEventBus();
  let source: CatalogSourceDto = {
    url: DEFAULT,
    default: DEFAULT,
    origin: 'default',
    ...initial,
  };
  const calls: (string | null)[] = [];
  const engine = {
    subscribe: bus.subscribe,
    extensions: {
      catalogSource: async () => ({ ...source }),
      setCatalogUrl: async (url: string | null) => {
        calls.push(url);
        const reason = url === null ? undefined : reject[url];
        if (reason !== undefined) {
          throw new FakeEngineError('INVALID_ARGUMENT', 'bad address', {
            details: { field: 'url', reason },
          });
        }
        source = {
          ...source,
          url: url === null ? DEFAULT : new URL(url).href,
          origin: url === null ? 'default' : 'setting',
        };
        return { catalogUrl: url === null ? null : new URL(url).href };
      },
    },
  } as unknown as LearningEngine;
  const scope = effectScope();
  const model = scope.run(() => useCatalogSource(engine))!;
  return {
    model,
    calls,
    bus,
    scope,
    setSource: (next: CatalogSourceDto) => (source = next),
  };
};

describe('useCatalogSource', () => {
  it('читает действующий адрес и ставит его в поле', async () => {
    const { model } = setup();
    await model.load();
    expect(model.source.value).toEqual({
      url: DEFAULT,
      default: DEFAULT,
      origin: 'default',
    });
    expect(model.draft.value).toBe(DEFAULT);
    expect(model.canApply.value).toBe(false);
    expect(model.canReset.value).toBe(false);
  });

  it('«Применить» доступна только для другого непустого адреса', async () => {
    const { model } = setup();
    await model.load();
    model.draft.value = '   ';
    expect(model.canApply.value).toBe(false);
    model.draft.value = OWN;
    expect(model.canApply.value).toBe(true);
  });

  it('применяет адрес без пробелов, поле показывает принятое значение, «Сбросить» становится доступной', async () => {
    const { model, calls } = setup();
    await model.load();
    model.draft.value = '  HTTPS://Own.test/catalog/index.json ';
    expect(await model.apply()).toBe(true);
    expect(calls).toEqual(['HTTPS://Own.test/catalog/index.json']);
    expect(model.source.value).toMatchObject({ url: OWN, origin: 'setting' });
    expect(model.draft.value).toBe(OWN);
    expect(model.error.value).toBeNull();
    expect(model.canReset.value).toBe(true);
    expect(model.canApply.value).toBe(false);
  });

  it('сброс возвращает умолчание и в поле', async () => {
    const { model, calls } = setup({ url: OWN, origin: 'setting' });
    await model.load();
    expect(model.canReset.value).toBe(true);
    expect(await model.reset()).toBe(true);
    expect(calls).toEqual([null]);
    expect(model.source.value).toMatchObject({
      url: DEFAULT,
      origin: 'default',
    });
    expect(model.draft.value).toBe(DEFAULT);
    expect(model.canReset.value).toBe(false);
  });

  it('неверный адрес: причина рядом с полем, текст и действующее значение не меняются', async () => {
    const { model } = setup({}, { 'ftp://x.test/i.json': 'scheme' });
    await model.load();
    model.draft.value = 'ftp://x.test/i.json';
    expect(await model.apply()).toBe(false);
    expect(model.error.value).toEqual({ kind: 'rejected', reason: 'scheme' });
    expect(model.draft.value).toBe('ftp://x.test/i.json');
    expect(model.source.value?.url).toBe(DEFAULT);
    expect(model.busy.value).toBe(false);
    // следующая попытка очищает ошибку
    model.draft.value = OWN;
    expect(await model.apply()).toBe(true);
    expect(model.error.value).toBeNull();
  });

  it('прочий отказ движка — текст ошибки', async () => {
    const bus = createEventBus();
    const engine = {
      subscribe: bus.subscribe,
      extensions: {
        catalogSource: async () => ({
          url: DEFAULT,
          default: DEFAULT,
          origin: 'default' as const,
        }),
        setCatalogUrl: async () => {
          throw new FakeEngineError('INTERNAL', 'disk is full');
        },
      },
    } as unknown as LearningEngine;
    const model = effectScope().run(() => useCatalogSource(engine))!;
    await model.load();
    model.draft.value = OWN;
    expect(await model.apply()).toBe(false);
    expect(model.error.value).toEqual({
      kind: 'failed',
      message: 'disk is full',
    });
  });

  it('адрес из окружения: поле заблокировано, применить нельзя, сбросить нельзя', async () => {
    const { model } = setup({
      url: 'http://127.0.0.1:1/index.json',
      origin: 'env',
    });
    await model.load();
    expect(model.locked.value).toBe(true);
    model.draft.value = OWN;
    expect(model.canApply.value).toBe(false);
    expect(model.canReset.value).toBe(false);
  });

  it('перечитывает адрес по extensions-changed и settings-changed; правка пользователя в поле не затирается', async () => {
    const { model, bus, setSource } = setup();
    await model.load();
    model.draft.value = 'https://typing.test/i.json';
    setSource({ url: OWN, default: DEFAULT, origin: 'setting' });
    bus.emit({ type: 'settings-changed', scope: 'extensions' });
    await flush();
    expect(model.source.value?.url).toBe(OWN);
    expect(model.draft.value).toBe('https://typing.test/i.json');

    setSource({ url: DEFAULT, default: DEFAULT, origin: 'default' });
    bus.emit({ type: 'extensions-changed' });
    await flush();
    expect(model.source.value?.origin).toBe('default');
  });

  it('поле показывает принятый адрес, даже если параллельное чтение по событию отбросило чтение после применения', async () => {
    const { model, bus } = setup();
    await model.load();
    model.draft.value = '  HTTPS://Own.test/catalog/index.json';
    const applying = model.apply();
    // событие приходит, пока команда ещё не вернулась: его чтение становится последним
    bus.emit({ type: 'extensions-changed' });
    await applying;
    await flush();
    expect(model.draft.value).toBe(OWN);
    expect(model.source.value?.url).toBe(OWN);
  });

  it('снимает подписку вместе с областью', async () => {
    const { scope, bus } = setup();
    expect(bus.count()).toBe(1);
    scope.stop();
    expect(bus.count()).toBe(0);
  });
});

describe('isFromAnotherCatalog', () => {
  const installed = { catalogUrl: OWN };

  it('сравнивает адрес установки с действующим', () => {
    expect(isFromAnotherCatalog(installed, OWN)).toBe(false);
    expect(isFromAnotherCatalog(installed, DEFAULT)).toBe(true);
  });

  it('без сведений об установке или пока адрес не прочитан — нет', () => {
    expect(isFromAnotherCatalog(null, DEFAULT)).toBe(false);
    expect(isFromAnotherCatalog(installed, null)).toBe(false);
  });
});

describe('catalogUrlRejection', () => {
  it('узнаёт только известные причины', () => {
    expect(catalogUrlRejection({ reason: 'not-json' })).toBe('not-json');
    expect(catalogUrlRejection({ reason: 'env' })).toBe('env');
    expect(catalogUrlRejection({ reason: 'other' })).toBeNull();
    expect(catalogUrlRejection({ field: 'url' })).toBeNull();
    expect(catalogUrlRejection(undefined)).toBeNull();
  });
});
