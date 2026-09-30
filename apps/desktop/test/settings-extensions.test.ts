import { effectScope } from 'vue';
import { describe, expect, it } from 'vitest';
import type { ExtensionInfoDto, LearningEngine } from '@lms/engine-contract';
import {
  contributionGroups,
  useExtensions,
} from '@/pages/settings/model/extensions.ts';

const NO_CONTRIBUTES: ExtensionInfoDto['contributes'] = {
  exerciseTypes: [],
  themes: [],
  markdownRenderers: [],
  gradePolicies: [],
};

const extension = (
  id: string,
  override: Partial<ExtensionInfoDto> = {},
): ExtensionInfoDto => ({
  id,
  version: '1.0.0',
  origin: 'bundled',
  state: 'loaded',
  contributes: { ...NO_CONTRIBUTES, exerciseTypes: [id] },
  message: null,
  ...override,
});

interface Deferred {
  resolve(list: ExtensionInfoDto[]): void;
  reject(error: Error): void;
}

/** Каждый вызов `list()` ждёт, пока тест его не завершит. */
const createFakeEngine = () => {
  const pending: Deferred[] = [];
  const engine = {
    extensions: {
      list: () =>
        new Promise<ExtensionInfoDto[]>((resolve, reject) => {
          pending.push({ resolve, reject });
        }),
    },
  } as unknown as LearningEngine;
  return { engine, pending };
};

const MICROTASK_ROUNDS = 10;
const flush = async () => {
  for (let round = 0; round < MICROTASK_ROUNDS; round++)
    await Promise.resolve();
};

const mount = (engine: LearningEngine) =>
  effectScope().run(() => useExtensions(engine))!;

describe('useExtensions', () => {
  it('loading → loaded: список в порядке движка', async () => {
    const { engine, pending } = createFakeEngine();
    const model = mount(engine);
    expect(model.state.value).toBe('loading');
    expect(model.busy.value).toBe(true);

    const list = [
      extension('lms.sql'),
      extension('lms.choice', {
        state: 'overridden',
        message: 'overridden by user 1.0.1',
      }),
    ];
    pending[0]?.resolve(list);
    await flush();

    expect(model.state.value).toBe('loaded');
    expect(model.busy.value).toBe(false);
    expect(model.error.value).toBeNull();
    expect(model.items.value.map((item) => item.id)).toEqual([
      'lms.sql',
      'lms.choice',
    ]);
  });

  it('ошибка → failed, повтор загружает список', async () => {
    const { engine, pending } = createFakeEngine();
    const model = mount(engine);
    pending[0]?.reject(new Error('engine is down'));
    await flush();
    expect(model.state.value).toBe('failed');
    expect(model.error.value).toBe('engine is down');
    expect(model.items.value).toEqual([]);

    const retry = model.load();
    expect(model.state.value).toBe('loading');
    pending[1]?.resolve([extension('lms.sql')]);
    await retry;

    expect(model.state.value).toBe('loaded');
    expect(model.error.value).toBeNull();
    expect(model.items.value).toHaveLength(1);
  });

  it('обновление перечитывает список и не прячет прежний на время запроса', async () => {
    const { engine, pending } = createFakeEngine();
    const model = mount(engine);
    pending[0]?.resolve([extension('lms.sql')]);
    await flush();

    const refresh = model.load();
    expect(model.state.value).toBe('loaded');
    expect(model.busy.value).toBe(true);
    expect(model.items.value).toHaveLength(1);

    pending[1]?.resolve([extension('lms.sql'), extension('acme.echo')]);
    await refresh;
    expect(model.items.value.map((item) => item.id)).toEqual([
      'lms.sql',
      'acme.echo',
    ]);
    expect(model.busy.value).toBe(false);
  });

  it('сбой обновления оставляет прежний список и показывает ошибку', async () => {
    const { engine, pending } = createFakeEngine();
    const model = mount(engine);
    pending[0]?.resolve([extension('lms.sql')]);
    await flush();

    const refresh = model.load();
    pending[1]?.reject(new Error('timeout'));
    await refresh;

    expect(model.state.value).toBe('loaded');
    expect(model.error.value).toBe('timeout');
    expect(model.items.value).toHaveLength(1);
  });

  it('ответ устаревшего запроса не затирает более свежий', async () => {
    const { engine, pending } = createFakeEngine();
    const model = mount(engine);
    const second = model.load();
    pending[1]?.resolve([extension('fresh')]);
    await second;
    pending[0]?.resolve([extension('stale')]);
    await flush();

    expect(model.items.value.map((item) => item.id)).toEqual(['fresh']);
    expect(model.busy.value).toBe(false);
  });
});

describe('contributionGroups', () => {
  it('пропускает пустые точки и сохраняет порядок точек и значения', () => {
    expect(
      contributionGroups({
        exerciseTypes: [],
        themes: ['acme.night', 'acme.day'],
        markdownRenderers: ['math'],
        gradePolicies: ['acme.strict'],
      }),
    ).toEqual([
      { point: 'themes', values: ['acme.night', 'acme.day'] },
      { point: 'markdownRenderers', values: ['math'] },
      { point: 'gradePolicies', values: ['acme.strict'] },
    ]);
  });

  it('расширение без вкладов — без групп', () => {
    expect(contributionGroups(NO_CONTRIBUTES)).toEqual([]);
  });
});
