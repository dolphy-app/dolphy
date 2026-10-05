import { effectScope } from 'vue';
import { describe, expect, it } from 'vitest';
import type {
  CatalogDto,
  ExtensionInfoDto,
  ExtensionSettingsDto,
  ExtensionUpdateDto,
  ExtensionsDiagnosticsDto,
  LearningEngine,
} from '@dolphy-app/engine-contract';
import {
  COLLAPSED_VALUES,
  contributionGroups,
  hasSwitches,
  hidesContributions,
  useExtensions,
  visibleValues,
} from '@/pages/settings/model/extensions.ts';
import {
  NO_CONTRIBUTES,
  catalogDto,
  catalogEntry,
  createEventBus,
  diagnosticsDto,
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
  safeMode: false,
  notificationsOff: [],
  catalogUrl: null,
};

/** Каждый вызов `list()` ждёт, пока тест его не завершит. */
const createFakeEngine = (stored: ExtensionSettingsDto = NONE_SET) => {
  const pending: Deferred[] = [];
  const engine = {
    subscribe: createEventBus().subscribe,
    extensions: {
      updates: async () => [],
      diagnostics: async () => diagnosticsDto(),
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
      extension('dolphy.sql'),
      extension('dolphy.choice', {
        state: 'overridden',
        diagnostics: [
          {
            code: 'overridden-by',
            data: { origin: 'user', version: '1.0.1' },
          },
        ],
      }),
    ];
    pending[0]?.resolve(list);
    await flush();

    expect(model.state.value).toBe('loaded');
    expect(model.busy.value).toBe(false);
    expect(model.error.value).toBeNull();
    expect(model.items.value.map((item) => item.id)).toEqual([
      'dolphy.sql',
      'dolphy.choice',
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
    pending[1]?.resolve([extension('dolphy.sql')]);
    await retry;

    expect(model.state.value).toBe('loaded');
    expect(model.error.value).toBeNull();
    expect(model.items.value).toHaveLength(1);
  });

  it('обновление перечитывает список и не прячет прежний на время запроса', async () => {
    const { engine, pending } = createFakeEngine();
    const model = mount(engine);
    pending[0]?.resolve([extension('dolphy.sql')]);
    await flush();

    const refresh = model.load();
    expect(model.state.value).toBe('loaded');
    expect(model.busy.value).toBe(true);
    expect(model.items.value).toHaveLength(1);

    pending[1]?.resolve([extension('dolphy.sql'), extension('acme.echo')]);
    await refresh;
    expect(model.items.value.map((item) => item.id)).toEqual([
      'dolphy.sql',
      'acme.echo',
    ]);
    expect(model.busy.value).toBe(false);
  });

  it('сбой обновления оставляет прежний список и показывает ошибку', async () => {
    const { engine, pending } = createFakeEngine();
    const model = mount(engine);
    pending[0]?.resolve([extension('dolphy.sql')]);
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
  const item = (id: string, label = id, extra = {}) => ({
    id,
    label,
    mono: false,
    duplicate: false,
    ...extra,
  });

  it('пропускает пустые точки и сохраняет порядок точек и значения; без названий текст — id', () => {
    expect(
      contributionGroups({
        exerciseTypes: [],
        themes: ['acme.night', 'acme.day'],
        markdownRenderers: ['math'],
        gradePolicies: ['acme.strict'],
        settings: [],
        events: [],
        commands: ['acme.run'],
        panels: ['acme.view'],
        widgets: ['acme.card'],
        importers: [],
        exporters: [],
      }),
    ).toEqual([
      {
        point: 'themes',
        items: [item('acme.night'), item('acme.day')],
      },
      {
        point: 'markdownRenderers',
        items: [item('math', 'math', { mono: true })],
      },
      { point: 'gradePolicies', items: [item('acme.strict')] },
      { point: 'commands', items: [item('acme.run')] },
      { point: 'panels', items: [item('acme.view')] },
      { point: 'widgets', items: [item('acme.card')] },
    ]);
  });

  it('расширение без вкладов — без групп', () => {
    expect(contributionGroups(NO_CONTRIBUTES)).toEqual([]);
  });

  it('название заменяет id, а id без названия остаётся запасным текстом', () => {
    const [group] = contributionGroups(
      { ...NO_CONTRIBUTES, themes: ['a.night', 'a.day'] },
      { themes: { 'a.night': 'Полночь' } },
    );
    expect(group?.items.map((i) => i.label)).toEqual(['Полночь', 'a.day']);
  });

  it('виды заданий и языки — идентификаторы моноширинно; названия и события — нет', () => {
    const groups = contributionGroups(
      {
        ...NO_CONTRIBUTES,
        exerciseTypes: ['a.quiz'],
        markdownRenderers: ['math'],
        themes: ['a.t'],
        events: ['session.started'],
      },
      { themes: { 'a.t': 'Тема' } },
    );
    expect(
      Object.fromEntries(groups.map((g) => [g.point, g.items[0]?.mono])),
    ).toEqual({
      exerciseTypes: true,
      themes: false,
      markdownRenderers: true,
      events: false,
    });
  });

  it('вид задания и рендерер с названием — обычным шрифтом, без названия — id моноширинно', () => {
    const groups = contributionGroups(
      {
        ...NO_CONTRIBUTES,
        exerciseTypes: ['a.quiz', 'a.plain'],
        markdownRenderers: ['math', 'chart'],
      },
      {
        exerciseTypes: { 'a.quiz': 'Викторина' },
        markdownRenderers: { math: 'Формулы' },
      },
    );
    expect(groups.map((g) => g.items.map((i) => [i.label, i.mono]))).toEqual([
      [
        ['Викторина', false],
        ['a.plain', true],
      ],
      [
        ['Формулы', false],
        ['chart', true],
      ],
    ]);
  });

  it('события показываются через переданное название, неизвестные — как есть', () => {
    const [group] = contributionGroups(
      { ...NO_CONTRIBUTES, events: ['session.started', 'weird.event'] },
      {},
      (name) => (name === 'session.started' ? 'Начало занятия' : name),
    );
    expect(group?.items.map((i) => i.label)).toEqual([
      'Начало занятия',
      'weird.event',
    ]);
  });

  it('одинаковые названия помечены, чтобы id был доступен скринридеру', () => {
    const [group] = contributionGroups(
      { ...NO_CONTRIBUTES, commands: ['a.one', 'a.two', 'a.three'] },
      {
        commands: {
          'a.one': 'Запустить',
          'a.two': 'Запустить',
          'a.three': 'Стоп',
        },
      },
    );
    expect(group?.items.map((i) => i.duplicate)).toEqual([true, true, false]);
  });

  it('64 команды с названиями сворачиваются до первых значений', () => {
    const commands = Array.from({ length: 64 }, (_, i) => `a.c${i}`);
    const titles = {
      commands: Object.fromEntries(commands.map((id) => [id, `Команда ${id}`])),
    };
    const [group] = contributionGroups({ ...NO_CONTRIBUTES, commands }, titles);
    const collapsed = visibleValues(group?.items ?? [], false);
    expect(collapsed.shown).toHaveLength(COLLAPSED_VALUES);
    expect(collapsed.shown[0]?.label).toBe('Команда a.c0');
    expect(collapsed.hidden).toBe(64 - COLLAPSED_VALUES);
  });
});

describe('hidesContributions', () => {
  const theme = { ...NO_CONTRIBUTES, themes: ['a.night'] };
  const titles = { themes: { 'a.night': 'Полночь' } };

  it('единственная тема с названием расширения не повторяется', () => {
    expect(hidesContributions(theme, titles, 'Полночь')).toBe(true);
  });

  it.each([
    ['название отличается', theme, titles, 'Night'],
    ['названия нет', theme, {}, 'Полночь'],
    ['у расширения нет названия', theme, titles, null],
    [
      'вкладов два',
      { ...theme, commands: ['a.run'] },
      { ...titles, commands: { 'a.run': 'Полночь' } },
      'Полночь',
    ],
    [
      'единственный вклад — не тема',
      { ...NO_CONTRIBUTES, commands: ['a.run'] },
      { commands: { 'a.run': 'Полночь' } },
      'Полночь',
    ],
    ['две темы', { ...theme, themes: ['a.night', 'a.day'] }, titles, 'Полночь'],
  ] as const)('показывается, если %s', (_why, contributes, t, name) => {
    expect(
      hidesContributions(
        contributes as never,
        t as never,
        name as string | null,
      ),
    ).toBe(false);
  });
});

describe('visibleValues', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `acme.c${i}`);

  it('короткая группа показана целиком и не сворачивается', () => {
    expect(visibleValues(ids(COLLAPSED_VALUES), false)).toEqual({
      shown: ids(COLLAPSED_VALUES),
      hidden: 0,
    });
  });

  it('длинная группа (до 64 команд) свёрнута до первых значений, остальное считается', () => {
    const result = visibleValues(ids(64), false);
    expect(result.shown).toEqual(ids(COLLAPSED_VALUES));
    expect(result.hidden).toBe(64 - COLLAPSED_VALUES);
  });

  it('раскрытая группа показана целиком', () => {
    expect(visibleValues(ids(64), true)).toEqual({
      shown: ids(64),
      hidden: 0,
    });
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
    method: 'setEnabled' | 'setTrusted' | 'setNotificationsEnabled';
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
        diagnostics: async () => diagnosticsDto(),
        list: async () => {
          listCalls += 1;
          return [extension('acme.x', { origin: 'user', toggleable: true })];
        },
        getSettings: async () => stored,
        setEnabled: write('setEnabled'),
        setTrusted: write('setTrusted'),
        setNotificationsEnabled: write('setNotificationsEnabled'),
      },
    } as unknown as LearningEngine;
    return { engine, calls, listCalls: () => listCalls };
  };

  it('переключатель меняется сразу, успех сохраняет ответ движка и перечитывает список', async () => {
    const { engine, calls, listCalls } = createSwitchEngine();
    const model = mount(engine);
    await flush();

    const pending = model.setTrusted('acme.x', true);
    expect(model.settings.value.trusted).toEqual(['acme.x']);
    expect(model.switching.value.has('trusted:acme.x')).toBe(true);
    calls[0]?.resolve({
      disabled: [],
      trusted: ['acme.x'],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
    });
    await pending;

    expect(calls[0]).toMatchObject({ method: 'setTrusted', value: true });
    expect(model.settings.value).toEqual({
      disabled: [],
      trusted: ['acme.x'],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
    });
    expect(model.switching.value.size).toBe(0);
    expect(model.switchError.value).toBeNull();
    await flush();
    expect(listCalls()).toBe(2);
  });

  it('«Включено» хранится как отсутствие в списке отключённых', async () => {
    const { engine, calls } = createSwitchEngine({
      disabled: ['acme.x'],
      trusted: [],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
    });
    const model = mount(engine);
    await flush();
    const pending = model.setEnabled('acme.x', true);
    expect(model.settings.value.disabled).toEqual([]);
    calls[0]?.resolve({
      disabled: [],
      trusted: [],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
    });
    await pending;
    expect(calls[0]).toMatchObject({ method: 'setEnabled', value: true });
  });

  it('«Уведомления» хранятся как наличие в списке выключенных: выключение добавляет id и зовёт движок', async () => {
    const { engine, calls } = createSwitchEngine();
    const model = mount(engine);
    await flush();

    const pending = model.setNotifications('acme.x', false);
    expect(model.settings.value.notificationsOff).toEqual(['acme.x']);
    expect(model.switching.value.has('notifications:acme.x')).toBe(true);
    calls[0]?.resolve({ ...NONE_SET, notificationsOff: ['acme.x'] });
    await pending;

    expect(calls[0]).toMatchObject({
      method: 'setNotificationsEnabled',
      id: 'acme.x',
      value: false,
    });
    expect(model.settings.value.notificationsOff).toEqual(['acme.x']);
    expect(model.switching.value.size).toBe(0);
  });

  it('включение «Уведомлений» убирает id из списка, отказ движка возвращает его и показывает ошибку', async () => {
    const { engine, calls } = createSwitchEngine({
      ...NONE_SET,
      notificationsOff: ['acme.x'],
      catalogUrl: null,
    });
    const model = mount(engine);
    await flush();

    const pending = model.setNotifications('acme.x', true);
    expect(model.settings.value.notificationsOff).toEqual([]);
    calls[0]?.reject(new Error('cannot write'));
    await pending;

    expect(model.settings.value.notificationsOff).toEqual(['acme.x']);
    expect(model.switchError.value).toBe('cannot write');
  });

  it('отказ движка откатывает переключатель и показывает ошибку', async () => {
    const { engine, calls } = createSwitchEngine();
    const model = mount(engine);
    await flush();

    const pending = model.setEnabled('acme.x', false);
    expect(model.settings.value.disabled).toEqual(['acme.x']);
    calls[0]?.reject(new Error('cannot write'));
    await pending;

    expect(model.settings.value).toEqual(NONE_SET);
    expect(model.switchError.value).toBe('cannot write');
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
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
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
    diagnostics?: () => Promise<ExtensionsDiagnosticsDto>;
    setSafeMode?: (value: boolean) => Promise<ExtensionSettingsDto>;
    restartHost?: () => Promise<void>;
  }

  const createEngine = (options: Options = {}) => {
    const bus = createEventBus();
    let listCalls = 0;
    let updateCalls = 0;
    let diagnosticsCalls = 0;
    let stored = options.settings ?? NONE_SET;
    const engine = {
      subscribe: bus.subscribe,
      extensions: {
        diagnostics: async () => {
          diagnosticsCalls += 1;
          return (options.diagnostics ?? (async () => diagnosticsDto()))();
        },
        setSafeMode: async (value: boolean) => {
          const next = await (options.setSafeMode ?? (async () => NONE_SET))(
            value,
          );
          stored = next;
          return next;
        },
        restartHost: options.restartHost ?? (async () => {}),
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
        getSettings: async () => stored,
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
      diagnosticsCalls: () => diagnosticsCalls,
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

  it('extensions-changed и contributions-changed перечитывают список и обновления', async () => {
    const { engine, bus, listCalls, updateCalls } = createEngine();
    mount(engine);
    await flush();
    expect([listCalls(), updateCalls()]).toEqual([1, 1]);

    bus.emit({ type: 'extensions-changed' });
    await flush();
    expect([listCalls(), updateCalls()]).toEqual([2, 2]);

    // правка в режиме разработчика сообщает только о вкладах
    bus.emit({ type: 'contributions-changed', generation: 3 });
    await flush();
    expect([listCalls(), updateCalls()]).toEqual([3, 3]);

    bus.emit({
      type: 'library-reloaded',
      revision: 'r',
      errors: 0,
      warnings: 0,
    });
    await flush();
    expect(listCalls()).toBe(3);
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

    fail = false;
    await model.setCheckUpdates(false);
    expect(model.settings.value.checkUpdates).toBe(false);
    expect(model.switchError.value).toBeNull();
  });

  it('здоровье и состояние хоста читаются вместе со списком; сбой их чтения не прячет список', async () => {
    const health = {
      id: 'acme.x',
      failures: 2,
      lastFailure: { at: 1, reason: 'timeout', message: 'slow' },
      lastActivationMs: 12,
      suppressedUntil: null,
    };
    const ok = createEngine({
      diagnostics: async () =>
        diagnosticsDto({ host: 'gave-up', extensions: [health] }),
    });
    const model = mount(ok.engine);
    await flush();
    expect(model.diagnostics.value?.host).toBe('gave-up');
    expect(model.diagnostics.value?.extensions).toEqual([health]);

    const broken = createEngine({
      diagnostics: async () => {
        throw new Error('no health');
      },
    });
    const other = mount(broken.engine);
    await flush();
    expect(other.state.value).toBe('loaded');
    expect(other.items.value).toHaveLength(1);
    expect(other.diagnostics.value).toBeNull();
  });

  it('extension-health-changed перечитывает только здоровье, список остаётся', async () => {
    const { engine, bus, listCalls, diagnosticsCalls } = createEngine();
    mount(engine);
    await flush();
    expect([listCalls(), diagnosticsCalls()]).toEqual([1, 1]);

    bus.emit({ type: 'extension-health-changed' });
    await flush();

    expect([listCalls(), diagnosticsCalls()]).toEqual([1, 2]);
  });

  it('«Безопасный режим»: меняется сразу, ответ движка сохраняется и список перечитывается; отказ откатывает', async () => {
    let fail = true;
    const { engine, listCalls } = createEngine({
      setSafeMode: async (value) => {
        if (fail) throw new Error('disk is full');
        return { ...NONE_SET, safeMode: value };
      },
    });
    const model = mount(engine);
    await flush();

    const rejected = model.setSafeMode(true);
    expect(model.settings.value.safeMode).toBe(true);
    await rejected;
    expect(model.settings.value.safeMode).toBe(false);
    expect(model.switchError.value).toBe('disk is full');

    fail = false;
    await model.setSafeMode(true);
    await flush();
    expect(model.settings.value.safeMode).toBe(true);
    expect(model.switchError.value).toBeNull();
    expect(listCalls()).toBe(2);
  });

  it('restartHost просит движок, перечитывает здоровье и не допускает второго нажатия; отказ показывается', async () => {
    let release: () => void = () => {};
    const calls: string[] = [];
    let fail = false;
    const { engine, diagnosticsCalls } = createEngine({
      restartHost: () =>
        new Promise<void>((resolve, reject) => {
          calls.push('restart');
          release = () => (fail ? reject(new Error('refused')) : resolve());
        }),
    });
    const model = mount(engine);
    await flush();

    const first = model.restartHost();
    void model.restartHost();
    expect(model.restartingHost.value).toBe(true);
    release();
    await first;
    expect(calls).toEqual(['restart']);
    expect(model.restartingHost.value).toBe(false);
    expect(diagnosticsCalls()).toBe(2);

    fail = true;
    const failed = model.restartHost();
    release();
    await failed;
    expect(model.switchError.value).toBe('refused');
    expect(model.restartingHost.value).toBe(false);
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
