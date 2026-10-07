import { MAX_ANSWER_CHARS } from '@dolphy-app/engine-contract';
import type {
  ExtensionInfoDto,
  LearningEngine,
} from '@dolphy-app/engine-contract';
import {
  createFakeExtensionPolicy,
  createFakeExtensionRegistry,
  createFakeExtensionRpc,
} from '@dolphy-app/testkit';
import { describe, expect, it } from 'vitest';
import { createMemorySettingsStore } from '../../../src/node/memory-settings-store.ts';
import { ExtensionRpcError } from '../../../src/ports/extension-rpc.ts';
import type { ExtensionRpcErrorCause } from '../../../src/ports/extension-rpc.ts';
import { createTestEngine } from '../../helpers/engine.ts';

const ID = 'acme.rpc';
const NAME = 'greeting.say-hello';

const info = (overrides: Partial<ExtensionInfoDto> = {}): ExtensionInfoDto => ({
  id: ID,
  version: '1.0.0',
  origin: 'user',
  state: 'loaded',
  contributes: {
    exerciseTypes: [],
    gradePolicies: [],
    settings: [],
    events: [],
    commands: [],
    schedules: [],
    importers: [],
    exporters: [],
  },
  diagnostics: [],
  toggleable: true,
  name: null,
  description: null,
  author: null,
  dependencies: [],
  installed: null,
  icon: null,
  tags: [],
  removable: true,
  revoked: null,
  deprecated: null,
  ...overrides,
});

interface OpenOptions {
  items?: ExtensionInfoDto[];
  handler?: (input: unknown) => unknown;
  disabled?: string[];
}

const open = (options: OpenOptions = {}) => {
  const extensionRpc = createFakeExtensionRpc({
    [`${ID}/${NAME}`]: (input) =>
      options.handler?.(input) ?? { greeting: input },
  });
  // настройки движка при запуске попадают в политику: отключение берётся из хранилища
  const settings = createMemorySettingsStore({
    extensions: {
      disabled: options.disabled ?? [],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
      schedulesOff: [],
    },
  });
  return createTestEngine({
    extensionRpc,
    extensionPolicy: createFakeExtensionPolicy(),
    settings,
    extensionRegistry: createFakeExtensionRegistry(options.items ?? [info()]),
  }).then((opened) => ({ ...opened, extensionRpc }));
};

const call = (engine: LearningEngine, input?: unknown) =>
  engine.extensions.invokeRpc({ extensionId: ID, name: NAME, input });

describe('extensions.invokeRpc', () => {
  it('передаёт вход порту и возвращает его результат как есть', async () => {
    const { engine, extensionRpc } = await open();

    expect(await call(engine, { who: 'Ann' })).toEqual({
      greeting: { who: 'Ann' },
    });
    await call(engine);

    expect(extensionRpc.calls).toEqual([
      { extensionId: ID, name: NAME, input: { who: 'Ann' } },
      { extensionId: ID, name: NAME, input: undefined },
    ]);
  });

  it.each([
    ['id расширения не по шаблону', 'Acme', NAME],
    ['пустое имя', ID, ''],
    ['имя без точки', ID, 'greeting'],
    ['имя с заглавной буквой', ID, 'Greeting.say'],
    ['дефис в первом сегменте', ID, 'my-greeting.say'],
    ['имя длиннее 120 знаков', ID, `a.${'b'.repeat(119)}`],
  ])('%s — INVALID_ARGUMENT, порт не вызывается', async (_title, id, name) => {
    const { engine, extensionRpc } = await open();

    await expect(
      engine.extensions.invokeRpc({ extensionId: id, name, input: 1 }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(extensionRpc.calls).toEqual([]);
  });

  it('имя на границе 120 знаков и дефис не в первом сегменте допустимы', async () => {
    const { engine, extensionRpc } = await open();
    const longest = `a.${'b'.repeat(118)}`;

    await engine.extensions
      .invokeRpc({ extensionId: ID, name: longest, input: 1 })
      .catch(() => null);
    await call(engine, 1);

    expect(extensionRpc.calls.map(({ name }) => name)).toEqual([longest, NAME]);
  });

  it('вход до 200 000 знаков проходит, длиннее — INVALID_ARGUMENT без обращения к расширению', async () => {
    const { engine, extensionRpc } = await open();
    // JSON.stringify добавляет две кавычки
    const fits = 'x'.repeat(MAX_ANSWER_CHARS - 2);

    await call(engine, fits);
    await expect(call(engine, `${fits}x`)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { field: 'input', reason: 'args-too-large' },
    });
    expect(extensionRpc.calls).toHaveLength(1);
  });

  it('отключённое расширение — EXTENSION_RPC_FAILED reason disabled, порт не вызывается', async () => {
    const { engine, extensionRpc } = await open({ disabled: [ID] });

    await expect(call(engine)).rejects.toMatchObject({
      code: 'EXTENSION_RPC_FAILED',
      retryable: false,
      details: { extensionId: ID, name: NAME, reason: 'disabled' },
    });
    expect(extensionRpc.calls).toEqual([]);
  });

  it.each([
    ['расширения нет в реестре', { items: [] }],
    ['расширение перекрыто', { items: [info({ state: 'overridden' })] }],
    ['расширение некорректно', { items: [info({ state: 'invalid' })] }],
  ] satisfies [string, OpenOptions][])(
    '%s — unknown-rpc, порт не вызывается',
    async (_title, options) => {
      const { engine, extensionRpc } = await open(options);

      await expect(call(engine)).rejects.toMatchObject({
        code: 'EXTENSION_RPC_FAILED',
        details: { reason: 'unknown-rpc' },
      });
      expect(extensionRpc.calls).toEqual([]);
    },
  );

  it.each([
    ['unknown-rpc', false],
    ['host-down', true],
    ['timeout', true],
    ['handler-failed', false],
    ['invalid-input', false],
    ['invalid-result', false],
    ['replaced', false],
    ['activation-timeout', false],
  ] as [ExtensionRpcErrorCause, boolean][])(
    'отказ порта %s -> EXTENSION_RPC_FAILED с текстом обработчика, повтор допустим: %s',
    async (cause, retryable) => {
      const { engine } = await open({
        handler: () => {
          throw new ExtensionRpcError(cause, ID, NAME, 'text from extension');
        },
      });

      await expect(call(engine)).rejects.toMatchObject({
        code: 'EXTENSION_RPC_FAILED',
        message: 'text from extension',
        retryable,
        details: { extensionId: ID, name: NAME, reason: cause },
      });
    },
  );

  it('сбой обработчика и срок попадают в здоровье расширения, неверный вход и неизвестное имя — нет', async () => {
    const causes: ExtensionRpcErrorCause[] = [
      'invalid-input',
      'unknown-rpc',
      'handler-failed',
      'timeout',
    ];
    const { engine } = await open({
      handler: (index) => {
        const cause = causes[Number(index)] ?? 'handler-failed';
        throw new ExtensionRpcError(cause, ID, NAME, cause);
      },
    });

    for (const index of causes.keys()) {
      await call(engine, index).catch(() => null);
    }

    const { extensions } = await engine.extensions.diagnostics();
    expect(extensions.find(({ id }) => id === ID)).toMatchObject({
      failures: 2,
      lastFailure: { reason: 'timeout' },
    });
  });

  it('ошибка программиста порта не маскируется под отказ RPC: INTERNAL', async () => {
    const { engine } = await open({
      handler: () => {
        throw new TypeError('bug');
      },
    });

    await expect(call(engine)).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('медленный вызов не занимает очередь: другие вызовы движка идут, пока он работает', async () => {
    let started: () => void = () => {};
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release: () => void = () => {};
    const { engine } = await open({
      handler: () =>
        new Promise<string>((resolve) => {
          release = () => resolve('late');
          started();
        }),
    });

    const slow = call(engine);
    await running;
    // очередь занята — этот вызов не вернулся бы до `release`
    expect(await engine.extensions.list()).toHaveLength(1);

    release();
    expect(await slow).toBe('late');
  });
});
