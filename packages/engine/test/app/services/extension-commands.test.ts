import { MAX_ANSWER_CHARS } from '@dolphy-app/engine-contract';
import type {
  CommandContributionDto,
  CommandResultDto,
  ExtensionInfoDto,
  PanelContributionDto,
} from '@dolphy-app/engine-contract';
import {
  createFakeExtensionCommands,
  createFakeExtensionPolicy,
  createFakeExtensionRegistry,
} from '@dolphy-app/testkit';
import { createMemorySettingsStore } from '../../../src/node/memory-settings-store.ts';
import { describe, expect, it } from 'vitest';
import { ExtensionCommandError } from '../../../src/ports/extension-commands.ts';
import type { ExtensionCommandErrorCause } from '../../../src/ports/extension-commands.ts';
import { createTestEngine } from '../../helpers/engine.ts';

const ID = 'acme.cmd';

const info = (overrides: Partial<ExtensionInfoDto> = {}): ExtensionInfoDto => ({
  id: ID,
  version: '1.0.0',
  origin: 'user',
  state: 'loaded',
  contributes: {
    exerciseTypes: [],
    themes: [],
    markdownRenderers: [],
    gradePolicies: [],
    settings: [],
    events: [],
    commands: [`${ID}.run`],
    panels: [],
  },
  message: null,
  permissions: [],
  isolation: 'isolated',
  toggleable: true,
  name: null,
  description: null,
  author: null,
  installed: null,
  removable: true,
  revoked: null,
  ...overrides,
});

const command = (id: string, extensionId = ID): CommandContributionDto => ({
  id,
  extensionId,
  title: id,
  description: null,
  category: null,
  keybinding: null,
  palette: true,
});

const panel = (id: string, extensionId = ID): PanelContributionDto => ({
  id,
  extensionId,
  title: id,
  rendererUrl: `dolphy-ext://${extensionId}/panel.mjs`,
  isolated: true,
  origin: 'user',
  revision: 'r1',
});

const NOTIFY: CommandResultDto = { kind: 'notify', text: 'done' };

interface OpenOptions {
  items?: ExtensionInfoDto[];
  commands?: CommandContributionDto[];
  handler?: (args: unknown) => CommandResultDto | Promise<CommandResultDto>;
  disabled?: string[];
}

const open = (options: OpenOptions = {}) => {
  const extensionCommands = createFakeExtensionCommands({
    [`${ID}/${ID}.run`]: (args) => options.handler?.(args) ?? NOTIFY,
  });
  // настройки движка при запуске попадают в политику: отключение берётся из хранилища
  const settings = createMemorySettingsStore({
    extensions: {
      disabled: options.disabled ?? [],
      trusted: [],
      checkUpdates: true,
    },
  });
  return createTestEngine({
    extensionCommands,
    extensionPolicy: createFakeExtensionPolicy(),
    settings,
    extensionRegistry: createFakeExtensionRegistry(options.items ?? [info()], {
      exerciseTypes: [],
      themes: [],
      markdownRenderers: [],
      gradePolicies: [],
      settings: [],
      commands: options.commands ?? [command(`${ID}.run`)],
      panels: [],
    }),
  }).then((opened) => ({ ...opened, extensionCommands }));
};

describe('extensions.invokeCommand', () => {
  it('передаёт аргументы порту и возвращает его результат как есть', async () => {
    const { engine, extensionCommands } = await open();

    expect(
      await engine.extensions.invokeCommand(ID, `${ID}.run`, { n: [1] }),
    ).toEqual(NOTIFY);
    await engine.extensions.invokeCommand(ID, `${ID}.run`);

    expect(extensionCommands.calls).toEqual([
      { extensionId: ID, commandId: `${ID}.run`, args: { n: [1] } },
      { extensionId: ID, commandId: `${ID}.run`, args: undefined },
    ]);
  });

  it.each([
    ['id расширения не по шаблону', ['Acme', `${ID}.run`]],
    ['пустой id расширения', ['', `${ID}.run`]],
    ['пустой id команды', [ID, '']],
  ])('%s — INVALID_ARGUMENT, порт не вызывается', async (_name, [ext, cmd]) => {
    const { engine, extensionCommands } = await open();

    await expect(
      engine.extensions.invokeCommand(ext as string, cmd as string),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(extensionCommands.calls).toEqual([]);
  });

  it('аргументы до 200 000 знаков проходят, длиннее — INVALID_ARGUMENT без обращения к расширению', async () => {
    const { engine, extensionCommands } = await open();
    // JSON.stringify добавляет две кавычки
    const fits = 'x'.repeat(MAX_ANSWER_CHARS - 2);

    await engine.extensions.invokeCommand(ID, `${ID}.run`, fits);
    await expect(
      engine.extensions.invokeCommand(ID, `${ID}.run`, `${fits}x`),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { field: 'args', reason: 'args-too-large' },
    });
    expect(extensionCommands.calls).toHaveLength(1);
  });

  it('отключённое расширение — EXTENSION_COMMAND_FAILED reason disabled, порт не вызывается', async () => {
    const { engine, extensionCommands } = await open({ disabled: [ID] });

    await expect(
      engine.extensions.invokeCommand(ID, `${ID}.run`),
    ).rejects.toMatchObject({
      code: 'EXTENSION_COMMAND_FAILED',
      retryable: false,
      details: { extensionId: ID, commandId: `${ID}.run`, reason: 'disabled' },
    });
    expect(extensionCommands.calls).toEqual([]);
  });

  it.each([
    ['расширения нет в реестре', { items: [] }],
    ['расширение перекрыто', { items: [info({ state: 'overridden' })] }],
    ['расширение некорректно', { items: [info({ state: 'invalid' })] }],
    ['команда не объявлена', { commands: [command(`${ID}.other`)] }],
    [
      'команда объявлена другим расширением',
      { commands: [command(`${ID}.run`, 'acme.other')] },
    ],
  ] satisfies [string, OpenOptions][])(
    '%s — unknown-command, порт не вызывается',
    async (_name, options) => {
      const { engine, extensionCommands } = await open(options);

      await expect(
        engine.extensions.invokeCommand(ID, `${ID}.run`),
      ).rejects.toMatchObject({
        code: 'EXTENSION_COMMAND_FAILED',
        details: { reason: 'unknown-command' },
      });
      expect(extensionCommands.calls).toEqual([]);
    },
  );

  it.each([
    ['unknown-command', false],
    ['host-down', true],
    ['timeout', true],
    ['handler-failed', false],
    ['invalid-result', false],
    ['replaced', false],
  ] as [ExtensionCommandErrorCause, boolean][])(
    'отказ порта %s -> EXTENSION_COMMAND_FAILED, повтор допустим: %s',
    async (cause, retryable) => {
      const { engine } = await open({
        handler: () => {
          throw new ExtensionCommandError(
            cause,
            ID,
            `${ID}.run`,
            'text from extension',
          );
        },
      });

      await expect(
        engine.extensions.invokeCommand(ID, `${ID}.run`),
      ).rejects.toMatchObject({
        code: 'EXTENSION_COMMAND_FAILED',
        message: 'text from extension',
        retryable,
        details: { extensionId: ID, commandId: `${ID}.run`, reason: cause },
      });
    },
  );

  it('ошибка программиста порта не маскируется под отказ команды: INTERNAL', async () => {
    const { engine } = await open({
      handler: () => {
        throw new TypeError('bug');
      },
    });

    await expect(
      engine.extensions.invokeCommand(ID, `${ID}.run`),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('медленная команда не занимает очередь: другие вызовы движка идут, пока она работает', async () => {
    let started: () => void = () => {};
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release: () => void = () => {};
    const { engine } = await open({
      handler: () =>
        new Promise<CommandResultDto>((resolve) => {
          release = () => resolve(NOTIFY);
          started();
        }),
    });

    const slow = engine.extensions.invokeCommand(ID, `${ID}.run`);
    await running;
    // очередь занята — этот вызов не вернулся бы до `release`
    expect(await engine.extensions.list()).toHaveLength(1);

    release();
    expect(await slow).toEqual(NOTIFY);
  });
});

describe('extensions.contributions: команды и панели', () => {
  it('сортирует по расширению, внутри расширения сохраняет порядок манифеста', async () => {
    const { engine } = await createTestEngine({
      extensionRegistry: createFakeExtensionRegistry([], {
        exerciseTypes: [],
        themes: [],
        markdownRenderers: [],
        gradePolicies: [],
        settings: [],
        commands: [
          command('b.ext.z', 'b.ext'),
          command('a.ext.z', 'a.ext'),
          command('a.ext.a', 'a.ext'),
        ],
        panels: [panel('b.ext.p', 'b.ext'), panel('a.ext.q', 'a.ext')],
      }),
    });

    const result = await engine.extensions.contributions();

    expect(result.commands.map(({ id }) => id)).toEqual([
      'a.ext.z',
      'a.ext.a',
      'b.ext.z',
    ]);
    expect(result.panels.map(({ id }) => id)).toEqual(['a.ext.q', 'b.ext.p']);
  });

  it('список расширений несёт id команд и панелей копиями', async () => {
    const { engine } = await open({
      items: [
        info({
          contributes: { ...info().contributes, panels: [`${ID}.screen`] },
        }),
      ],
    });

    const [first] = await engine.extensions.list();
    first?.contributes.commands.push('evil');

    expect((await engine.extensions.list())[0]?.contributes).toMatchObject({
      commands: [`${ID}.run`],
      panels: [`${ID}.screen`],
    });
  });
});
