import { effectScope } from 'vue';
import { describe, expect, it } from 'vitest';
import type {
  CatalogDto,
  ExtensionInfoDto,
  ExtensionSettingsDto,
  ExtensionUpdateDto,
  LearningEngine,
} from '@spirula-app/engine-contract';
import {
  contributionGroups,
  hasSwitches,
  useExtensions,
} from '@/pages/settings/model/extensions.ts';
import {
  NO_CONTRIBUTES,
  catalogDto,
  catalogEntry,
  createEventBus,
  extensionInfo as extension,
  flush,
} from './support/extensions-fakes.ts';

interface Deferred {
  resolve(list: ExtensionInfoDto[]): void;
  reject(error: Error): void;
}

const NONE_SET: ExtensionSettingsDto = {
  disabled: [],
  trusted: [],
  checkUpdates: true,
};

/** Каждый вызов `list()` ждёт, пока тест его не завершит. */
const createFakeEngine = (stored: ExtensionSettingsDto = NONE_SET) => {
  const pending: Deferred[] = [];
  const engine = {
    subscribe: createEventBus().subscribe,
    extensions: {
      updates: async () => [],
      list: () =>
        new Promise<ExtensionInfoDto[]>((resolve, reject) => {
          pending.push({ resolve, reject });
        }),
      getSettings: async () => stored,
    },
  } as unknown as LearningEngine;
  return { engine, pending };
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
      extension('spirula.sql'),
      extension('spirula.choice', {
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
      'spirula.sql',
      'spirula.choice',
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
    pending[1]?.resolve([extension('spirula.sql')]);
    await retry;

    expect(model.state.value).toBe('loaded');
    expect(model.error.value).toBeNull();
    expect(model.items.value).toHaveLength(1);
  });

  it('обновление перечитывает список и не прячет прежний на время запроса', async () => {
    const { engine, pending } = createFakeEngine();
    const model = mount(engine);
    pending[0]?.resolve([extension('spirula.sql')]);
    await flush();

    const refresh = model.load();
    expect(model.state.value).toBe('loaded');
    expect(model.busy.value).toBe(true);
    expect(model.items.value).toHaveLength(1);

    pending[1]?.resolve([extension('spirula.sql'), extension('acme.echo')]);
    await refresh;
    expect(model.items.value.map((item) => item.id)).toEqual([
      'spirula.sql',
      'acme.echo',
    ]);
    expect(model.busy.value).toBe(false);
  });

  it('сбой обновления оставляет прежний список и показывает ошибку', async () => {
    const { engine, pending } = createFakeEngine();
    const model = mount(engine);
    pending[0]?.resolve([extension('spirula.sql')]);
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

describe('hasSwitches', () => {
  it.each([
    [{ toggleable: true, state: 'loaded' }, true],
    [{ toggleable: true, state: 'disabled' }, true],
    [{ toggleable: false, state: 'loaded' }, false],
    [{ toggleable: true, state: 'overridden' }, false],
    [{ toggleable: true, state: 'invalid' }, false],
  ] as const)('%j → %s', (override, expected) => {
    expect(hasSwitches(extension('acme.x', override))).toBe(expected);
  });
});

describe('переключатели', () => {
  interface Call {
    method: 'setEnabled' | 'setTrusted';
    id: string;
    value: boolean;
    resolve(next: ExtensionSettingsDto): void;
    reject(error: Error): void;
  }

  /** Список и настройки читаются сразу; записи ждут, пока тест их не завершит. */
  const createSwitchEngine = (stored: ExtensionSettingsDto = NONE_SET) => {
    const calls: Call[] = [];
    let listCalls = 0;
    const write = (method: Call['method']) => (id: string, value: boolean) =>
      new Promise<ExtensionSettingsDto>((resolve, reject) => {
        calls.push({ method, id, value, resolve, reject });
      });
    const engine = {
      subscribe: createEventBus().subscribe,
      extensions: {
        updates: async () => [],
        list: async () => {
          listCalls += 1;
          return [extension('acme.x', { origin: 'user', toggleable: true })];
        },
        getSettings: async () => stored,
        setEnabled: write('setEnabled'),
        setTrusted: write('setTrusted'),
      },
    } as unknown as LearningEngine;
    return { engine, calls, listCalls: () => listCalls };
  };

  it('переключатель меняется сразу, успех сохраняет ответ движка и просит перезагрузку', async () => {
    const { engine, calls, listCalls } = createSwitchEngine();
    const model = mount(engine);
    await flush();
    expect(model.needsReload.value).toBe(false);

    const pending = model.setTrusted('acme.x', true);
    expect(model.settings.value.trusted).toEqual(['acme.x']);
    expect(model.switching.value.has('trusted:acme.x')).toBe(true);
    calls[0]?.resolve({
      disabled: [],
      trusted: ['acme.x'],
      checkUpdates: true,
    });
    await pending;

    expect(calls[0]).toMatchObject({ method: 'setTrusted', value: true });
    expect(model.settings.value).toEqual({
      disabled: [],
      trusted: ['acme.x'],
      checkUpdates: true,
    });
    expect(model.switching.value.size).toBe(0);
    expect(model.needsReload.value).toBe(true);
    expect(model.switchError.value).toBeNull();
    await flush();
    expect(listCalls()).toBe(2);
  });

  it('«Включено» хранится как отсутствие в списке отключённых', async () => {
    const { engine, calls } = createSwitchEngine({
      disabled: ['acme.x'],
      trusted: [],
      checkUpdates: true,
    });
    const model = mount(engine);
    await flush();
    const pending = model.setEnabled('acme.x', true);
    expect(model.settings.value.disabled).toEqual([]);
    calls[0]?.resolve({ disabled: [], trusted: [], checkUpdates: true });
    await pending;
    expect(calls[0]).toMatchObject({ method: 'setEnabled', value: true });
  });

  it('отказ движка откатывает переключатель и показывает ошибку без перезагрузки', async () => {
    const { engine, calls } = createSwitchEngine();
    const model = mount(engine);
    await flush();

    const pending = model.setEnabled('acme.x', false);
    expect(model.settings.value.disabled).toEqual(['acme.x']);
    calls[0]?.reject(new Error('cannot write'));
    await pending;

    expect(model.settings.value).toEqual(NONE_SET);
    expect(model.switchError.value).toBe('cannot write');
    expect(model.needsReload.value).toBe(false);
    expect(model.switching.value.size).toBe(0);
  });

  it('повторное нажатие на занятый переключатель игнорируется', async () => {
    const { engine, calls } = createSwitchEngine();
    const model = mount(engine);
    await flush();
    const first = model.setTrusted('acme.x', true);
    await model.setTrusted('acme.x', false);
    expect(calls).toHaveLength(1);
    calls[0]?.resolve({
      disabled: [],
      trusted: ['acme.x'],
      checkUpdates: true,
    });
    await first;
  });
});

describe('revoked', () => {
  it('у отозванного расширения переключателей нет', () => {
    expect(
      hasSwitches(
        extension('acme.x', {
          toggleable: true,
          state: 'disabled',
          revoked: 'leaks tokens',
        }),
      ),
    ).toBe(false);
  });
});

describe('обновления и установка из каталога', () => {
  const UPDATE: ExtensionUpdateDto = {
    id: 'acme.x',
    name: 'Acme X',
    installed: '1.0.0',
    available: {
      version: '1.1.0',
      permissions: ['network'],
      publishedAt: '2026-01-01T00:00:00.000Z',
      size: 100,
      minAppVersion: null,
    },
  };

  interface Options {
    updates?: ExtensionUpdateDto[] | Error;
    settings?: ExtensionSettingsDto;
    setCheckUpdates?: (value: boolean) => Promise<ExtensionSettingsDto>;
    catalog?: () => Promise<CatalogDto>;
  }

  const createEngine = (options: Options = {}) => {
    const bus = createEventBus();
    let listCalls = 0;
    let updateCalls = 0;
    const engine = {
      subscribe: bus.subscribe,
      extensions: {
        list: async () => {
          listCalls += 1;
          return [
            extension('acme.x', {
              origin: 'user',
              toggleable: true,
              author: 'acme',
              contributes: { ...NO_CONTRIBUTES, themes: ['old'] },
            }),
          ];
        },
        getSettings: async () => options.settings ?? NONE_SET,
        updates: async () => {
          updateCalls += 1;
          if (options.updates instanceof Error) throw options.updates;
          return options.updates ?? [];
        },
        setCheckUpdates: options.setCheckUpdates ?? (async () => NONE_SET),
        catalog:
          options.catalog ??
          (async () => {
            throw new Error('offline');
          }),
      },
    } as unknown as LearningEngine;
    return {
      engine,
      bus,
      listCalls: () => listCalls,
      updateCalls: () => updateCalls,
    };
  };

  it('доступные обновления читаются вместе со списком', async () => {
    const { engine } = createEngine({ updates: [UPDATE] });
    const model = mount(engine);
    await flush();
    expect(model.updates.value).toEqual([UPDATE]);
  });

  it('сбой чтения обновлений не прячет список', async () => {
    const { engine } = createEngine({ updates: new Error('no index') });
    const model = mount(engine);
    await flush();
    expect(model.state.value).toBe('loaded');
    expect(model.updates.value).toEqual([]);
    expect(model.items.value).toHaveLength(1);
  });

  it('extensions-changed перечитывает список и обновления', async () => {
    const { engine, bus, listCalls, updateCalls } = createEngine();
    mount(engine);
    await flush();
    expect([listCalls(), updateCalls()]).toEqual([1, 1]);

    bus.emit({ type: 'extensions-changed' });
    await flush();
    expect([listCalls(), updateCalls()]).toEqual([2, 2]);

    bus.emit({
      type: 'library-reloaded',
      revision: 'r',
      errors: 0,
      warnings: 0,
    });
    await flush();
    expect(listCalls()).toBe(2);
  });

  it('«Проверять обновления при запуске»: меняется сразу, отказ откатывает и показывает ошибку', async () => {
    let fail = true;
    const { engine } = createEngine({
      setCheckUpdates: async (value) => {
        if (fail) throw new Error('disk is full');
        return { ...NONE_SET, checkUpdates: value };
      },
    });
    const model = mount(engine);
    await flush();

    const rejected = model.setCheckUpdates(false);
    expect(model.settings.value.checkUpdates).toBe(false);
    await rejected;
    expect(model.settings.value.checkUpdates).toBe(true);
    expect(model.switchError.value).toBe('disk is full');
    expect(model.needsReload.value).toBe(false);

    fail = false;
    await model.setCheckUpdates(false);
    expect(model.settings.value.checkUpdates).toBe(false);
    expect(model.switchError.value).toBeNull();
  });

  it('updateTargets берёт вклады и платформы из каталога, а без него — из установленного', async () => {
    const withCatalog = createEngine({
      updates: [UPDATE],
      catalog: async () =>
        catalogDto([
          catalogEntry('acme.x', {
            author: 'acme',
            platforms: ['darwin'],
            contributes: { ...NO_CONTRIBUTES, themes: ['new'] },
          }),
        ]),
    });
    const fromCatalog = mount(withCatalog.engine);
    await flush();
    expect(await fromCatalog.updateTargets()).toMatchObject([
      {
        id: 'acme.x',
        version: '1.1.0',
        installedVersion: '1.0.0',
        permissions: ['network'],
        platforms: ['darwin'],
        contributes: { themes: ['new'] },
      },
    ]);

    const offline = createEngine({ updates: [UPDATE] });
    const fromInstalled = mount(offline.engine);
    await flush();
    expect(await fromInstalled.updateTargets(['acme.x'])).toMatchObject([
      { platforms: [], contributes: { themes: ['old'] }, author: 'acme' },
    ]);
    expect(await fromInstalled.updateTargets(['acme.other'])).toEqual([]);
  });
});
