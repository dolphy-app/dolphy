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
  palette: true,
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
          keybinding: 'Ctrl+Shift+S',
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
      keybinding: 'Ctrl+Shift+S',
      checked: undefined,
      enabled: true,
    });
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
