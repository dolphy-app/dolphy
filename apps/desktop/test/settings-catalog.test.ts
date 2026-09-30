import { effectScope } from 'vue';
import { describe, expect, it } from 'vitest';
import type { CatalogDto, LearningEngine } from '@spirula-app/engine-contract';
import { useCatalog } from '@/pages/settings/model/catalog.ts';
import {
  FakeEngineError,
  catalogDto,
  catalogEntry,
  createEventBus,
  flush,
} from './support/extensions-fakes.ts';

interface Call {
  options: { refresh?: boolean } | undefined;
  resolve(catalog: CatalogDto): void;
  reject(error: Error): void;
}

/** Каждый вызов `catalog()` ждёт, пока тест его не завершит. */
const setup = () => {
  const calls: Call[] = [];
  const bus = createEventBus();
  const engine = {
    subscribe: bus.subscribe,
    extensions: {
      catalog: (options?: { refresh?: boolean }) =>
        new Promise<CatalogDto>((resolve, reject) => {
          calls.push({ options, resolve, reject });
        }),
    },
  } as unknown as LearningEngine;
  const scope = effectScope();
  const model = scope.run(() => useCatalog(engine))!;
  return { model, calls, bus, scope };
};

const SUNRISE = catalogEntry('acme.sunrise', { name: 'Рассвет' });
const QUIZ = catalogEntry('acme.quiz', {
  name: 'Quiz',
  contributes: {
    exerciseTypes: ['acme.quiz'],
    themes: [],
    markdownRenderers: [],
    gradePolicies: [],
  },
});

describe('useCatalog', () => {
  it('индекс не запрашивается, пока вкладку не открыли; открытие грузит один раз', async () => {
    const { model, calls } = setup();
    expect(model.state.value).toBe('idle');
    expect(calls).toHaveLength(0);

    const opening = model.open();
    expect(model.state.value).toBe('loading');
    void model.open();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options).toBeUndefined();

    calls[0]?.resolve(catalogDto([SUNRISE, QUIZ]));
    await opening;
    expect(model.state.value).toBe('loaded');
    expect(model.entries.value.map((entry) => entry.id)).toEqual([
      'acme.sunrise',
      'acme.quiz',
    ]);
    expect(model.stale.value).toBe(false);
    expect(model.notice.value).toBeNull();
    expect(model.busy.value).toBe(false);

    await model.open();
    expect(calls).toHaveLength(1);
  });

  it('нет связи, но есть кэш: записи показаны, stale и короткая причина', async () => {
    const { model, calls } = setup();
    const opening = model.open();
    calls[0]?.resolve(
      catalogDto([SUNRISE], { stale: true, error: 'connect ECONNREFUSED' }),
    );
    await opening;

    expect(model.state.value).toBe('loaded');
    expect(model.stale.value).toBe(true);
    expect(model.notice.value).toBe('connect ECONNREFUSED');
    expect(model.entries.value).toHaveLength(1);
  });

  it('каталог недоступен и кэша нет: failed с сообщением движка, повтор загружает', async () => {
    const { model, calls } = setup();
    const opening = model.open();
    calls[0]?.reject(
      new FakeEngineError('CATALOG_UNAVAILABLE', 'catalog is unreachable', {
        retryable: true,
      }),
    );
    await opening;
    expect(model.state.value).toBe('failed');
    expect(model.failure.value).toBe('catalog is unreachable');
    expect(model.entries.value).toEqual([]);

    const retry = model.load();
    expect(model.state.value).toBe('loading');
    calls[1]?.resolve(catalogDto([SUNRISE]));
    await retry;
    expect(model.state.value).toBe('loaded');
    expect(model.failure.value).toBeNull();
  });

  it('обновление просит свежий индекс и не прячет показанные записи', async () => {
    const { model, calls } = setup();
    const opening = model.open();
    calls[0]?.resolve(catalogDto([SUNRISE]));
    await opening;

    const refreshing = model.load({ refresh: true });
    expect(calls[1]?.options).toEqual({ refresh: true });
    expect(model.state.value).toBe('loaded');
    expect(model.busy.value).toBe(true);
    expect(model.entries.value).toHaveLength(1);

    calls[1]?.resolve(catalogDto([SUNRISE, QUIZ]));
    await refreshing;
    expect(model.entries.value).toHaveLength(2);
    expect(model.busy.value).toBe(false);
  });

  it('сбой обновления при показанных записях оставляет их и помечает как сохранённые', async () => {
    const { model, calls } = setup();
    const opening = model.open();
    calls[0]?.resolve(catalogDto([SUNRISE]));
    await opening;

    const refreshing = model.load({ refresh: true });
    calls[1]?.reject(new Error('timeout'));
    await refreshing;

    expect(model.state.value).toBe('loaded');
    expect(model.entries.value).toHaveLength(1);
    expect(model.stale.value).toBe(true);
    expect(model.notice.value).toBe('timeout');
  });

  it('ответ устаревшего запроса не затирает более свежий', async () => {
    const { model, calls } = setup();
    const first = model.load();
    const second = model.load({ refresh: true });
    calls[1]?.resolve(catalogDto([QUIZ]));
    await second;
    calls[0]?.resolve(catalogDto([SUNRISE]));
    await first;

    expect(model.entries.value.map((entry) => entry.id)).toEqual(['acme.quiz']);
    expect(model.busy.value).toBe(false);
  });

  it('поиск и фильтры работают на клиенте и сбрасываются', async () => {
    const { model, calls } = setup();
    const opening = model.open();
    calls[0]?.resolve(catalogDto([SUNRISE, QUIZ]));
    await opening;

    model.query.value = 'РАССВЕТ';
    expect(model.visible.value.map((entry) => entry.id)).toEqual([
      'acme.sunrise',
    ]);
    expect(model.isFiltered.value).toBe(true);

    model.resetFilters();
    model.setKind('exerciseTypes', true);
    expect(model.visible.value.map((entry) => entry.id)).toEqual(['acme.quiz']);
    model.setKind('exerciseTypes', false);
    expect(model.visible.value).toHaveLength(2);
    expect(model.isFiltered.value).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('extensions-changed перечитывает каталог, но только открытый; после закрытия не слушает', async () => {
    const { model, calls, bus, scope } = setup();
    bus.emit({ type: 'extensions-changed' });
    await flush();
    expect(calls).toHaveLength(0);

    const opening = model.open();
    calls[0]?.resolve(catalogDto([SUNRISE]));
    await opening;

    bus.emit({ type: 'progress', unitIds: [], at: 0 });
    bus.emit({ type: 'extensions-changed' });
    await flush();
    expect(calls).toHaveLength(2);
    calls[1]?.resolve(
      catalogDto([
        catalogEntry('acme.sunrise', {
          status: 'installed',
          installedVersion: '1.0.0',
        }),
      ]),
    );
    await flush();
    expect(model.entries.value[0]?.status).toBe('installed');

    scope.stop();
    expect(bus.count()).toBe(0);
  });
});
