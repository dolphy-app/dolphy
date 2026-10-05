import { shallowRef } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type {
  CommandContributionDto,
  CommandResultDto,
  ContributionsDto,
} from '@dolphy-app/engine-contract';
import { createExtensionCommands } from '@/features/extension-commands/model/extension-commands.ts';
import { NO_CONTRIBUTIONS } from '@/shared/api/engine/contributions.ts';
import { createCommandRegistry } from '@/shared/lib/command-registry.ts';

const command = (
  id: string,
  override: Partial<CommandContributionDto> = {},
): CommandContributionDto => ({
  id,
  extensionId: 'acme.cmd',
  title: id,
  description: null,
  category: null,
  keybinding: null,
  keybindings: [],
  palette: true,
  icon: 'puzzle',
  ...override,
});

const contributionsOf = (
  commands: CommandContributionDto[],
  panelIds: [extensionId: string, panelId: string][] = [],
): ContributionsDto => ({
  ...NO_CONTRIBUTIONS,
  commands,
  panels: panelIds.map(([extensionId, id]) => ({
    id,
    extensionId,
    title: id,
    icon: 'puzzle',
    rendererUrl: `dolphy-ext://${extensionId}/panel.mjs`,
    isolated: true,
    origin: 'user',
    revision: 'r1',
  })),
});

const setup = (
  initial: ContributionsDto,
  result: CommandResultDto = { kind: 'none' },
) => {
  const contributions = shallowRef(initial);
  const locale = shallowRef('en');
  const registry = createCommandRegistry();
  const invokeCommand = vi.fn(async () => result);
  const openPanel = vi.fn();
  const extensionCommands = createExtensionCommands({
    registry,
    engine: { invokeCommand },
    contributions: () => contributions.value,
    locale: () => locale.value,
    openPanel,
  });
  const keys = () => registry.list.value.map(({ key }) => key);
  return {
    contributions,
    locale,
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

  it('подставляет %ключ% в название, описание и категорию; смена языка меняет подписи без перерегистрации', () => {
    const { locale, registry, contributions } = setup({
      ...contributionsOf([
        command('run', {
          title: '%run.title%',
          description: '%run.description%',
          category: '%run.category%',
        }),
        command('plain', { title: 'Plain title' }),
      ]),
      messages: {
        'acme.cmd': {
          en: {
            'run.title': 'Run',
            'run.description': 'Starts a run',
            'run.category': 'Learning',
          },
          ru: { 'run.title': 'Запуск', 'run.category': 'Обучение' },
        },
      },
    });
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
    // та же регистрация: язык не перерегистрирует команды
    expect(registry.list.value.map(({ run }) => run)).toEqual(before);
    // таблицы обновились (расширение обновлено): подпись следует за ними
    contributions.value = {
      ...contributions.value,
      messages: { 'acme.cmd': { en: { 'run.title': 'Go' } } },
    };
    expect(view()[0]).toEqual({
      title: 'Go',
      description: '%run.description%',
      category: '%run.category%',
    });
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

  it('openPanel открывает только панель своего расширения; чужая панель и маршруты приложения отклоняются', async () => {
    const own = setup(
      contributionsOf(
        [command('run')],
        [
          ['acme.cmd', 'main'],
          ['acme.other', 'main'],
        ],
      ),
      { kind: 'openPanel', panelId: 'main' },
    );
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

    const foreign = setup(
      contributionsOf([command('run')], [['acme.other', 'main']]),
      { kind: 'openPanel', panelId: 'main' },
    );
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
    await route.extensionCommands.runner.run(
      'acme.cmd',
      'run',
      undefined,
      'palette',
    );
    expect(route.openPanel).not.toHaveBeenCalled();
  });
});

describe('адаптер команд расширений: привязки', () => {
  const bound = (
    id: string,
    override: Partial<CommandContributionDto> = {},
  ): CommandContributionDto =>
    command(id, { keybinding: 'Mod+Shift+G', ...override });

  it('собирает привязки: сначала keybinding, затем keybindings; только palette:true; в описание команды они не попадают', () => {
    const { extensionCommands, registry } = setup(
      contributionsOf([
        bound('greet', {
          keybindings: [
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
      { command: 'extension:acme.cmd:greet', key: 'Mod+Shift+G' },
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
      bound('greet', { keybinding: 'Mod+Shift+H' }),
    ]);
    expect(extensionCommands.bindings.value).toEqual([
      { command: 'extension:acme.cmd:greet', key: 'Mod+Shift+H' },
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
