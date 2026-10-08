import { computed, shallowRef } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type {
  CommandContributionDto,
  CommandResultDto,
  ContributionsDto,
} from '@dolphy-app/engine-contract';
import type {
  ClientCommand,
  ClientPanel,
} from '@/shared/lib/extension-clients.ts';
import { createExtensionCommands } from '@/features/extension-commands/model/extension-commands.ts';
import { createNotices } from '@/features/extension-commands/model/notices.ts';
import { createPanelProps } from '@/features/extension-commands/model/panel-props.ts';
import { NO_CONTRIBUTIONS } from '@/shared/api/engine/contributions.ts';
import { createCommandRegistry } from '@/shared/lib/command-registry.ts';
import { createExtensionWhen } from '@/shared/lib/extension-when.ts';

const command = (
  id: string,
  override: Partial<CommandContributionDto> = {},
): CommandContributionDto => ({
  id,
  extensionId: 'acme.cmd',
  title: id,
  description: null,
  category: null,
  keybindings: [],
  when: null,
  palette: true,
  icon: 'puzzle',
  ...override,
});

const contributionsOf = (
  commands: CommandContributionDto[],
): ContributionsDto => ({ ...NO_CONTRIBUTIONS, commands });

const clientCommand = (
  id: string,
  override: Partial<ClientCommand> = {},
): ClientCommand => ({
  kind: 'command',
  key: `acme.cmd:${id}:1`,
  extensionId: 'acme.cmd',
  id,
  title: id,
  description: null,
  category: null,
  palette: true,
  icon: 'puzzle',
  when: null,
  keybindings: [],
  run: () => {},
  ...override,
});

const clientPanel = (extensionId: string, id: string): ClientPanel => ({
  kind: 'panel',
  key: `${extensionId}:${id}:1`,
  extensionId,
  id,
  title: id,
  icon: 'puzzle',
  when: null,
  header: true,
  component: {},
});

const setup = (
  initial: ContributionsDto,
  result: CommandResultDto = { kind: 'none' },
) => {
  const contributions = shallowRef(initial);
  const clientCommands = shallowRef<readonly ClientCommand[]>([]);
  const clientPanels = shallowRef<readonly ClientPanel[]>([]);
  const locale = shallowRef('en');
  const route = shallowRef<string>('daily-plan');
  const courseActive = shallowRef(false);
  const dark = shallowRef(false);
  const registry = createCommandRegistry();
  const invokeCommand = vi.fn(async () => result);
  const openPanel = vi.fn();
  const extensionCommands = createExtensionCommands({
    registry,
    engine: { invokeCommand },
    contributions: () => contributions.value,
    clients: {
      commands: computed(() => clientCommands.value),
      panels: computed(() => clientPanels.value),
    },
    locale: () => locale.value,
    when: createExtensionWhen({
      route: () => route.value,
      courseActive: () => courseActive.value,
      locale: () => locale.value,
      dark: () => dark.value,
    }),
    notices: createNotices(),
    panelProps: createPanelProps(),
    openPanel,
  });
  const keys = () => registry.list.value.map(({ key }) => key);
  return {
    contributions,
    clientCommands,
    clientPanels,
    locale,
    route,
    courseActive,
    dark,
    registry,
    invokeCommand,
    openPanel,
    extensionCommands,
    keys,
  };
};

describe('адаптер команд расширений: реестр', () => {
  it('регистрирует команды palette:true с ключом источника и подписью-расширением; palette:false не попадает', () => {
    const { registry, keys } = setup(
      contributionsOf([
        command('run', {
          title: 'Запуск',
          description: 'Описание',
          category: 'Обучение',
        }),
        command('hidden', { palette: false }),
      ]),
    );
    expect(keys()).toEqual(['extension:acme.cmd:run']);
    expect(registry.list.value[0]).toMatchObject({
      source: 'extension',
      title: 'Запуск',
      description: 'Описание',
      category: 'Обучение',
      caption: 'acme.cmd',
      defaultBindings: [],
      checked: undefined,
      enabled: true,
    });
  });

  it('значок команды — символ окна по имени из вклада; неизвестное имя — символ по умолчанию; смена значка перерегистрирует запись', () => {
    const { registry, contributions } = setup(
      contributionsOf([
        command('run', { icon: 'fire' }),
        command('plain', { icon: 'puzzle' }),
        command('future', { icon: 'rocket-from-a-newer-app' }),
      ]),
    );
    const icons = () =>
      Object.fromEntries(
        registry.list.value.map(({ key, icon }) => [key, icon]),
      );
    expect(icons()).toEqual({
      'extension:acme.cmd:run': 'mdi-fire',
      'extension:acme.cmd:plain': 'mdi-puzzle-outline',
      'extension:acme.cmd:future': 'mdi-puzzle-outline',
    });
    contributions.value = contributionsOf([
      command('run', { icon: 'trophy' }),
      command('plain', { icon: 'puzzle' }),
      command('future', { icon: 'rocket-from-a-newer-app' }),
    ]);
    expect(icons()['extension:acme.cmd:run']).toBe('mdi-trophy-outline');
  });

  it('подписи выбираются по языку окна; смена языка меняет их без перерегистрации', () => {
    const { locale, registry } = setup(
      contributionsOf([
        command('run', {
          title: { en: 'Run', ru: 'Запуск' },
          description: { en: 'Starts a run' },
          category: { en: 'Learning', ru: 'Обучение' },
        }),
        command('plain', { title: 'Plain title' }),
      ]),
    );
    const view = () =>
      registry.list.value.map(({ title, description, category }) => ({
        title,
        description,
        category,
      }));
    expect(view()).toEqual([
      { title: 'Run', description: 'Starts a run', category: 'Learning' },
      { title: 'Plain title', description: undefined, category: undefined },
    ]);
    const before = registry.list.value.map(({ run }) => run);
    locale.value = 'ru';
    expect(view()[0]).toEqual({
      title: 'Запуск',
      // нет в ru — берётся en
      description: 'Starts a run',
      category: 'Обучение',
    });
    expect(registry.list.value.map(({ run }) => run)).toEqual(before);
  });

  it('добавление, изменение и удаление вкладов обновляют реестр без перезагрузки', () => {
    const { contributions, registry, keys } = setup(
      contributionsOf([command('a', { title: 'A' })]),
    );
    contributions.value = contributionsOf([
      command('a', { title: 'A2' }),
      command('b', { extensionId: 'acme.other', title: 'B' }),
    ]);
    expect(keys()).toEqual(['extension:acme.cmd:a', 'extension:acme.other:b']);
    expect(registry.list.value.map(({ title }) => title)).toEqual(['A2', 'B']);
    contributions.value = contributionsOf([
      command('b', { extensionId: 'acme.other', title: 'B' }),
    ]);
    expect(keys()).toEqual(['extension:acme.other:b']);
    contributions.value = contributionsOf([
      command('b', { extensionId: 'acme.other', palette: false }),
    ]);
    expect(keys()).toEqual([]);
  });

  it('when: пока условие ложно, команда недоступна; смена маршрута, курса, языка и темы пересчитывает без перерегистрации', () => {
    const { registry, route, courseActive, locale, dark } = setup(
      contributionsOf([
        command('plain'),
        command('here', { when: "route == 'courses'" }),
        command('focused', { when: 'course.active' }),
        command('russian', { when: "locale == 'ru'" }),
        command('night', { when: 'theme.dark && !session.active' }),
      ]),
    );
    const enabled = () =>
      Object.fromEntries(
        registry.list.value.map(({ key, enabled }) => [
          key.split(':')[2],
          enabled,
        ]),
      );
    const before = registry.list.value.map(({ run }) => run);
    expect(enabled()).toEqual({
      plain: true,
      here: false,
      focused: false,
      russian: false,
      night: false,
    });

    route.value = 'courses';
    courseActive.value = true;
    locale.value = 'ru';
    dark.value = true;
    expect(enabled()).toEqual({
      plain: true,
      here: true,
      focused: true,
      russian: true,
      night: true,
    });

    route.value = 'session';
    expect(enabled()).toMatchObject({ here: false, night: false });
    expect(registry.list.value.map(({ run }) => run)).toEqual(before);
  });

  it('when: смена условия во вкладе заменяет запись; убранное условие делает команду доступной', () => {
    const { registry, contributions } = setup(
      contributionsOf([command('a', { when: "route == 'courses'" })]),
    );
    expect(registry.list.value[0]?.enabled).toBe(false);
    contributions.value = contributionsOf([
      command('a', { when: "route == 'daily-plan'" }),
    ]);
    expect(registry.list.value[0]?.enabled).toBe(true);
    contributions.value = contributionsOf([command('a', { when: null })]);
    expect(registry.list.value[0]?.enabled).toBe(true);
  });

  it('when: условие, которого окно не разбирает, скрывает команду', () => {
    const { registry } = setup(
      contributionsOf([command('a', { when: "route == 'no-such-screen'" })]),
    );
    expect(registry.list.value[0]?.enabled).toBe(false);
  });

  it('dispose снимает все команды расширений', () => {
    const { extensionCommands, keys } = setup(
      contributionsOf([command('a'), command('b')]),
    );
    extensionCommands.dispose();
    expect(keys()).toEqual([]);
  });

  it('команда выполняется прежним путём: объявленная команда уходит в движок, эффект notify — в уведомление', async () => {
    const { registry, invokeCommand, extensionCommands } = setup(
      contributionsOf([command('run')]),
      { kind: 'notify', text: 'готово' },
    );
    await registry.list.value[0]?.run();
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith(
      'acme.cmd',
      'run',
      undefined,
    );
    expect(extensionCommands.notices.current.value?.notice).toEqual({
      kind: 'notify',
      text: 'готово',
    });
  });

  it('команда, пропавшая из вкладов до выполнения, не уходит в движок: «расширение изменилось»', async () => {
    const { contributions, registry, invokeCommand, extensionCommands } = setup(
      contributionsOf([command('run')]),
    );
    const [entry] = registry.list.value;
    contributions.value = contributionsOf([]);
    await entry?.run();
    expect(invokeCommand).not.toHaveBeenCalled();
    expect(extensionCommands.notices.current.value?.notice).toMatchObject({
      kind: 'failure',
      failure: { kind: 'changed' },
    });
  });

  it('совпадение id команды расширения с id команды приложения не затирает запись приложения', () => {
    const { registry, contributions, keys } = setup(contributionsOf([]));
    const appRun = vi.fn();
    registry.register({
      key: 'app:go:settings',
      source: 'app',
      title: 'Перейти: Настройки',
      run: appRun,
    });
    contributions.value = contributionsOf([
      command('go:settings', { extensionId: 'app', title: 'Подмена' }),
      command('settings', { extensionId: 'go', title: 'Подмена 2' }),
    ]);
    expect(keys()).toEqual([
      'app:go:settings',
      'extension:app:go:settings',
      'extension:go:settings',
    ]);
    expect(registry.list.value[0]).toMatchObject({
      source: 'app',
      title: 'Перейти: Настройки',
    });
  });
});

describe('R9: расширения не вызывают команды приложения', () => {
  const FORGED: CommandResultDto[] = [
    { kind: 'none' },
    { kind: 'notify', text: 'app:go:settings' },
    { kind: 'data', value: { key: 'app:go:settings' } },
    // чужие виды результата, которых нет в протоколе, окно не исполняет
    { kind: 'runCommand', key: 'app:go:settings' } as never,
    { kind: 'executeCommand', command: 'app:go:settings' } as never,
  ];

  it.each(FORGED)(
    'результат %j не запускает команду приложения',
    async (result) => {
      const { registry, extensionCommands } = setup(
        contributionsOf([command('run')]),
        result,
      );
      const appRun = vi.fn();
      registry.register({
        key: 'app:go:settings',
        source: 'app',
        title: 'Перейти: Настройки',
        run: appRun,
      });
      const extension = registry.list.value.find(
        ({ source }) => source === 'extension',
      );
      await extension?.run();
      await extensionCommands.runner.run('acme.cmd', 'run', undefined, 'panel');
      expect(appRun).not.toHaveBeenCalled();
    },
  );

  it('openPanel проверяется по реестру окна: открывается только панель своего расширения; чужая и маршруты приложения отклоняются', async () => {
    const own = setup(contributionsOf([command('run')]), {
      kind: 'openPanel',
      panelId: 'main',
    });
    own.clientPanels.value = [
      clientPanel('acme.cmd', 'main'),
      clientPanel('acme.other', 'main'),
    ];
    await own.extensionCommands.runner.run(
      'acme.cmd',
      'run',
      undefined,
      'panel',
    );
    expect(own.openPanel).toHaveBeenCalledExactlyOnceWith({
      extensionId: 'acme.cmd',
      panelId: 'main',
    });

    const foreign = setup(contributionsOf([command('run')]), {
      kind: 'openPanel',
      panelId: 'main',
    });
    foreign.clientPanels.value = [clientPanel('acme.other', 'main')];
    await foreign.extensionCommands.runner.run(
      'acme.cmd',
      'run',
      undefined,
      'palette',
    );
    expect(foreign.openPanel).not.toHaveBeenCalled();

    const route = setup(contributionsOf([command('run')]), {
      kind: 'openPanel',
      panelId: '/settings',
    });
    route.clientPanels.value = [clientPanel('acme.cmd', 'main')];
    await route.extensionCommands.runner.run(
      'acme.cmd',
      'run',
      undefined,
      'palette',
    );
    expect(route.openPanel).not.toHaveBeenCalled();
  });
});

describe('клиентские команды', () => {
  it('попадают в реестр с ключом источника и подписями на языке окна; palette:false скрыта', () => {
    const { registry, clientCommands, locale, keys } = setup(
      contributionsOf([]),
    );
    clientCommands.value = [
      clientCommand('open', {
        title: { en: 'Open', ru: 'Открыть' },
        category: 'Tools',
        icon: 'fire',
      }),
      clientCommand('hidden', { palette: false }),
    ];
    expect(keys()).toEqual(['extension:acme.cmd:open']);
    expect(registry.list.value[0]).toMatchObject({
      source: 'extension',
      title: 'Open',
      category: 'Tools',
      caption: 'acme.cmd',
      icon: 'mdi-fire',
      enabled: true,
    });
    locale.value = 'ru';
    expect(registry.list.value[0]?.title).toBe('Открыть');
  });

  it('when скрывает команду и пересчитывается по окну', () => {
    const { registry, clientCommands, route } = setup(contributionsOf([]));
    clientCommands.value = [
      clientCommand('here', { when: "route == 'courses'" }),
    ];
    expect(registry.list.value[0]?.enabled).toBe(false);
    route.value = 'courses';
    expect(registry.list.value[0]?.enabled).toBe(true);
  });

  it('выполнение вызывает run в окне, движок не трогает', async () => {
    const { registry, clientCommands, invokeCommand } = setup(
      contributionsOf([]),
    );
    const run = vi.fn();
    clientCommands.value = [clientCommand('open', { run })];
    await registry.list.value[0]?.run();
    expect(run).toHaveBeenCalledOnce();
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it.each([
    [
      'исключение',
      () => {
        throw new Error('boom');
      },
    ],
    ['отклонённый промис', () => Promise.reject(new Error('boom'))],
  ])('сбой run (%s) — уведомление, без падения', async (_name, run) => {
    const { registry, clientCommands, extensionCommands } = setup(
      contributionsOf([]),
    );
    clientCommands.value = [clientCommand('open', { run })];
    await expect(registry.list.value[0]?.run()).resolves.toBeUndefined();
    expect(extensionCommands.notices.current.value?.notice).toEqual({
      kind: 'failure',
      failure: { kind: 'failed', message: 'boom' },
    });
  });

  it('при совпадении ключа серверная команда главнее клиентской', async () => {
    const { registry, clientCommands, invokeCommand, keys } = setup(
      contributionsOf([command('dup', { title: 'Server' })]),
    );
    const run = vi.fn();
    clientCommands.value = [clientCommand('dup', { title: 'Client', run })];
    expect(keys()).toEqual(['extension:acme.cmd:dup']);
    expect(registry.list.value[0]?.title).toBe('Server');
    await registry.list.value[0]?.run();
    expect(invokeCommand).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
  });

  it('привязки клиентских команд попадают в карту; palette:false — нет', () => {
    const { extensionCommands, clientCommands } = setup(contributionsOf([]));
    clientCommands.value = [
      clientCommand('open', {
        keybindings: [
          { key: 'Mod+J', mac: null, windows: null, linux: null, when: null },
        ],
      }),
      clientCommand('hidden', {
        palette: false,
        keybindings: [
          { key: 'Mod+H', mac: null, windows: null, linux: null, when: null },
        ],
      }),
    ];
    expect(extensionCommands.bindings.value).toEqual([
      {
        command: 'extension:acme.cmd:open',
        key: 'Mod+J',
        mac: null,
        windows: null,
        linux: null,
        when: null,
      },
    ]);
  });
});

describe('адаптер команд расширений: привязки', () => {
  const key = (value: string) => ({
    key: value,
    mac: null,
    windows: null,
    linux: null,
    when: null,
  });
  const bound = (
    id: string,
    override: Partial<CommandContributionDto> = {},
  ): CommandContributionDto =>
    command(id, { keybindings: [key('Mod+Shift+G')], ...override });

  it('собирает привязки: из keybindings серверных команд; только palette:true; в описание команды они не попадают', () => {
    const { extensionCommands, registry } = setup(
      contributionsOf([
        bound('greet', {
          keybindings: [
            key('Mod+Shift+G'),
            {
              key: 'Mod+J',
              mac: 'Ctrl+J',
              windows: null,
              linux: null,
              when: 'page == courses',
            },
          ],
        }),
        bound('hidden', { palette: false }),
        command('plain'),
      ]),
    );
    expect(extensionCommands.bindings.value).toEqual([
      { command: 'extension:acme.cmd:greet', ...key('Mod+Shift+G') },
      {
        command: 'extension:acme.cmd:greet',
        key: 'Mod+J',
        mac: 'Ctrl+J',
        windows: null,
        linux: null,
        when: 'page == courses',
      },
    ]);
    expect(
      registry.list.value.every(
        ({ defaultBindings }) => defaultBindings.length === 0,
      ),
    ).toBe(true);
  });

  it('порядок по extensionId, затем по порядку вклада', () => {
    const { extensionCommands } = setup(
      contributionsOf([
        bound('b', { extensionId: 'zeta.ext' }),
        bound('a', { extensionId: 'alpha.ext' }),
        bound('c', { extensionId: 'alpha.ext' }),
      ]),
    );
    expect(
      extensionCommands.bindings.value.map(({ command: key }) => key),
    ).toEqual([
      'extension:alpha.ext:a',
      'extension:alpha.ext:c',
      'extension:zeta.ext:b',
    ]);
  });

  it('смена одних привязок обновляет список и не перерегистрирует команду', () => {
    const { extensionCommands, registry, contributions } = setup(
      contributionsOf([bound('greet')]),
    );
    const before = registry.list.value.map(({ run }) => run);
    contributions.value = contributionsOf([
      bound('greet', { keybindings: [key('Mod+Shift+H')] }),
    ]);
    expect(extensionCommands.bindings.value).toEqual([
      { command: 'extension:acme.cmd:greet', ...key('Mod+Shift+H') },
    ]);
    expect(registry.list.value.map(({ run }) => run)).toEqual(before);
  });

  it('привязки пропадают вместе с расширением', () => {
    const { extensionCommands, contributions } = setup(
      contributionsOf([bound('greet')]),
    );
    contributions.value = contributionsOf([]);
    expect(extensionCommands.bindings.value).toEqual([]);
  });
});
