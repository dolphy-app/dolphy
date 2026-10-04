import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHostChannel } from '../src/channel.ts';
import { createRemoteExtensionCommands } from '../src/client.ts';
import type { ResolvedExtension } from '../src/discover.ts';
import { createEndpointPair } from '../src/loopback.ts';
import { createAllTrustedPolicy } from '../src/policy.ts';
import type { ExtRequest } from '../src/protocol.ts';
import { createLogger, holderOf } from './helpers.ts';
import { stateful } from './state-harness.ts';

afterEach(() => vi.useRealTimers());

const ID = 'acme.cmd';
const PANEL = `${ID}.panel`;

const extension: ResolvedExtension = stateful(ID, {
  permissions: [],
  events: [],
  settings: [],
  commands: [
    {
      id: `${ID}.run`,
      title: 'Run',
      description: null,
      category: null,
      keybinding: null,
      palette: true,
    },
  ],
  panels: [
    { id: PANEL, title: 'Panel', rendererUrl: `dolphy-ext://${ID}/panel.mjs` },
  ],
});

type Reply =
  | { ok: true; result: unknown }
  | { ok: false; error: { cause: string; message: string } };

/** Хост, которого тест заменяет сам: отвечает на `invokeCommand` заданным ответом или молчит. */
const setup = (reply: Reply | null, deadlineMs?: number) => {
  const restart = vi.fn();
  const logger = createLogger();
  const channel = createHostChannel({ logger, restart });
  const [engineSide, hostSide] = createEndpointPair();
  const requests: ExtRequest[] = [];
  hostSide.onMessage((message) => {
    const request = message as ExtRequest;
    requests.push(request);
    if (reply !== null) hostSide.post({ id: request.id, ...reply });
  });
  channel.attach(engineSide);
  const commands = createRemoteExtensionCommands({
    channel,
    discovery: holderOf([extension]),
    policy: createAllTrustedPolicy(),
    logger,
    ...(deadlineMs !== undefined && { deadlineMs }),
  });
  return { commands, restart, requests };
};

const invoke = (commands: ReturnType<typeof setup>['commands'], args?: never) =>
  commands.invoke(ID, `${ID}.run`, args);

describe('createRemoteExtensionCommands', () => {
  it('отправляет extensionId, commandId, режим исполнения и аргументы; без аргументов ключа args нет', async () => {
    const { commands, requests } = setup({
      ok: true,
      result: { kind: 'none' },
    });

    await invoke(commands, { n: 1 } as never);
    await invoke(commands);

    expect(requests.map(({ method, params }) => [method, params])).toEqual([
      [
        'invokeCommand',
        {
          extensionId: ID,
          commandId: `${ID}.run`,
          args: { n: 1 },
          isolated: false,
        },
      ],
      [
        'invokeCommand',
        { extensionId: ID, commandId: `${ID}.run`, isolated: false },
      ],
    ]);
  });

  it.each([
    [{ kind: 'none' }, { kind: 'none' }],
    [
      { kind: 'notify', text: 'Готово' },
      { kind: 'notify', text: 'Готово' },
    ],
    [
      { kind: 'data', value: [1, { a: null }] },
      { kind: 'data', value: [1, { a: null }] },
    ],
    [
      { kind: 'openPanel', panelId: PANEL },
      { kind: 'openPanel', panelId: PANEL },
    ],
    [
      { kind: 'openPanel', panelId: PANEL, props: { day: 1 } },
      { kind: 'openPanel', panelId: PANEL, props: { day: 1 } },
    ],
  ])('пропускает допустимый результат %j', async (result, expected) => {
    const { commands } = setup({ ok: true, result });

    expect(await invoke(commands)).toEqual(expected);
  });

  it.each([
    ['неизвестный вид', { kind: 'weird' }],
    ['не объект', 'text'],
    ['notify без текста', { kind: 'notify' }],
    ['пустой notify', { kind: 'notify', text: '' }],
    ['notify длиннее 500', { kind: 'notify', text: 'x'.repeat(501) }],
    ['лишний ключ', { kind: 'none', extra: 1 }],
    ['data больше 64 КиБ', { kind: 'data', value: 'x'.repeat(70_000) }],
    [
      'панель, которой нет у расширения',
      { kind: 'openPanel', panelId: 'acme.cmd.ghost' },
    ],
    ['data без value', { kind: 'data' }],
  ])(
    'ответ недоверенного процесса отвергается (%s): invalid-result',
    async (_name, result) => {
      const { commands } = setup({ ok: true, result });

      await expect(invoke(commands)).rejects.toMatchObject({
        name: 'ExtensionCommandError',
        cause: 'invalid-result',
      });
    },
  );

  it.each([
    ['unknown-command', 'unknown-command'],
    ['handler-failed', 'handler-failed'],
    ['invalid-result', 'invalid-result'],
    ['replaced', 'replaced'],
    ['handler-timeout', 'timeout'],
    ['activation-failed', 'handler-failed'],
    ['activation-timeout', 'activation-timeout'],
    ['unknown-type', 'handler-failed'],
  ])('причина хоста %s -> %s', async (cause, expected) => {
    const { commands } = setup({
      ok: false,
      error: { cause, message: 'text from the extension' },
    });

    await expect(invoke(commands)).rejects.toMatchObject({
      cause: expected,
      extensionId: ID,
      commandId: `${ID}.run`,
      message: 'text from the extension',
    });
  });

  it('хост не ответил к дедлайну клиента: timeout, перезапуск хоста не взводится', async () => {
    vi.useFakeTimers();
    const { commands, restart } = setup(null, 14_000);

    const outcome = invoke(commands).then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(13_900);
    expect(restart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);

    expect(await outcome).toMatchObject({ cause: 'timeout' });
    expect(restart).not.toHaveBeenCalled();
  });

  it('срок клиента по умолчанию — 14 с, больше срока обработчика (10 с) и раннера (12 с)', async () => {
    vi.useFakeTimers();
    const { commands } = setup(null);

    let settled = false;
    void invoke(commands).catch(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(13_900);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(settled).toBe(true);
  });
});
