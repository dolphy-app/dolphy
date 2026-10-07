import { ExtensionCommandError } from '@dolphy-app/engine/ports';
import type { ServerContext } from '@dolphy-app/extension-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerModule } from '../src/runtime.ts';
import { candidateOf, deferred } from './helpers.ts';
import { createHarness } from './state-harness.ts';
import type { Harness } from './state-harness.ts';

const ID = 'acme.cmd';
const PANEL = `${ID}.panel`;

let harness: Harness | null = null;
afterEach(async () => {
  vi.useRealTimers();
  await harness?.close();
  harness = null;
});

const open = async (
  ...args: Parameters<typeof createHarness>
): Promise<Harness> => {
  harness = await createHarness(...args);
  return harness;
};

type Handlers = Record<string, (args: unknown) => unknown>;

/** Регистрирует обработчики под `acme.cmd.<name>`. */
const registerAll = (s: ServerContext, handlers: Handlers): void => {
  for (const [name, run] of Object.entries(handlers)) {
    s.registerCommand({ id: `${ID}.${name}`, title: name, run: run as never });
  }
};

/** Серверная часть, регистрирующая команды `acme.cmd.<name>`. */
const moduleOf = (handlers: Handlers): ServerModule => ({
  server: (s) => registerAll(s, handlers),
});

const start = (handlers: Handlers) =>
  open({
    candidates: [candidateOf(ID)],
    modules: { [ID]: moduleOf(handlers) },
  });

const call = (h: Harness, name: string, args?: unknown) =>
  h.commands.invoke(ID, `${ID}.${name}`, args as never);

describe('s.registerCommand', () => {
  it('обработчик получает JSON-аргументы; без аргументов — undefined', async () => {
    const h = await start({ echo: (args) => ({ got: args ?? 'nothing' }) });

    expect(await call(h, 'echo', { a: [1, null] })).toEqual({
      kind: 'data',
      value: { got: { a: [1, null] } },
    });
    expect(await call(h, 'echo')).toEqual({
      kind: 'data',
      value: { got: 'nothing' },
    });
  });

  it('регистрация чужого id и повторная бросают из вызова, ошибка называет команду', async () => {
    const errors: string[] = [];
    const h = await open({
      candidates: [candidateOf(ID)],
      modules: {
        [ID]: {
          server(s) {
            s.registerCommand({ id: `${ID}.run`, title: 'run', run: () => 1 });
            for (const id of ['other.ghost', `${ID}.run`]) {
              try {
                s.registerCommand({ id, title: 'x', run: () => 2 });
              } catch (error) {
                errors.push((error as Error).message);
              }
            }
          },
        },
      },
    });

    expect(await call(h, 'run')).toEqual({ kind: 'data', value: 1 });
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("command 'other.ghost'");
    expect(errors[1]).toContain(`command '${ID}.run'`);
    expect(errors[1]).toContain('duplicate');
  });

  it('dispose снимает команду: следующий вызов — unknown-command', async () => {
    let registration: { dispose(): void | Promise<void> } | undefined;
    const h = await open({
      candidates: [candidateOf(ID)],
      modules: {
        [ID]: {
          server(s) {
            registration = s.registerCommand({
              id: `${ID}.run`,
              title: 'run',
              run: () => 1,
            });
          },
        },
      },
    });
    expect(await call(h, 'run')).toEqual({ kind: 'data', value: 1 });

    await registration?.dispose();

    await expect(call(h, 'run')).rejects.toMatchObject({
      cause: 'unknown-command',
    });
  });

  it('server вызывается один раз на сколько угодно вызовов команд', async () => {
    const server = vi.fn((s: ServerContext) =>
      registerAll(s, { a: () => 'a', b: () => 'b' }),
    );
    const h = await open({
      candidates: [candidateOf(ID)],
      modules: { [ID]: { server } },
    });

    await call(h, 'a');
    await call(h, 'b');
    await call(h, 'a');

    expect(server).toHaveBeenCalledTimes(1);
  });

  it('server, бросивший ошибку, оставляет расширение без команд: вызов — unknown-command', async () => {
    const h = await open({
      candidates: [candidateOf(ID)],
      modules: {
        [ID]: {
          server: (s) => {
            s.registerCommand({ id: `${ID}.run`, title: 'run', run: () => 1 });
            throw new Error('boom on start');
          },
        },
      },
    });

    await expect(call(h, 'run')).rejects.toMatchObject({
      name: 'ExtensionCommandError',
      cause: 'unknown-command',
    });
  });
});

describe('результат команды', () => {
  it.each([
    ['undefined', undefined, { kind: 'none' }],
    ['null', null, { kind: 'none' }],
    ['notify', { notify: 'Готово' }, { kind: 'notify', text: 'Готово' }],
    [
      'openPanel без props',
      { openPanel: PANEL },
      { kind: 'openPanel', panelId: PANEL },
    ],
    [
      'openPanel с props',
      { openPanel: PANEL, props: { day: 3 } },
      { kind: 'openPanel', panelId: PANEL, props: { day: 3 } },
    ],
    ['массив', [1, 'a', null], { kind: 'data', value: [1, 'a', null] }],
    ['число', 0, { kind: 'data', value: 0 }],
    ['строка', 'text', { kind: 'data', value: 'text' }],
    ['пустой объект', {}, { kind: 'data', value: {} }],
    [
      'объект с похожим ключом — данные',
      { notifyMe: true },
      { kind: 'data', value: { notifyMe: true } },
    ],
    [
      'поля undefined отбрасываются',
      { a: 1, b: undefined },
      { kind: 'data', value: { a: 1 } },
    ],
  ])('%s', async (_name, returned, expected) => {
    const h = await start({ run: () => returned });

    expect(await call(h, 'run')).toEqual(expected);
  });

  it('openPanel на любую панель хост пропускает: панели знает окно', async () => {
    const h = await start({ run: () => ({ openPanel: 'acme.other.p' }) });

    expect(await call(h, 'run')).toEqual({
      kind: 'openPanel',
      panelId: 'acme.other.p',
    });
  });

  it('асинхронный обработчик ждётся', async () => {
    const h = await start({
      run: async () => {
        await Promise.resolve();
        return { notify: 'later' };
      },
    });

    expect(await call(h, 'run')).toEqual({ kind: 'notify', text: 'later' });
  });

  const circular: Record<string, unknown> = {};
  circular.self = circular;
  it.each([
    ['функция', () => () => 1],
    ['BigInt', () => 10n],
    ['циклическая структура', () => circular],
    ['больше 64 КиБ', () => 'x'.repeat(65 * 1024)],
    ['пустой notify', () => ({ notify: '' })],
    ['notify длиннее 500 знаков', () => ({ notify: 'x'.repeat(501) })],
    ['notify не строка', () => ({ notify: 1 })],
    ['notify с лишним ключом', () => ({ notify: 'a', extra: 1 })],
    ['notify вместе с openPanel', () => ({ notify: 'a', openPanel: PANEL })],
    ['openPanel с лишним ключом', () => ({ openPanel: PANEL, extra: 1 })],
    ['openPanel не строка', () => ({ openPanel: 5 })],
  ])('недопустимый результат: %s — invalid-result', async (_name, make) => {
    const h = await start({ run: make as never, ok: () => 'ok' });

    await expect(call(h, 'run')).rejects.toMatchObject({
      name: 'ExtensionCommandError',
      cause: 'invalid-result',
    });
    // сбой одного вызова не ломает расширение
    expect(await call(h, 'ok')).toEqual({ kind: 'data', value: 'ok' });
  });
});

describe('сбои и таймауты', () => {
  it('неизвестная команда — unknown-command; соседняя команда работает', async () => {
    const h = await start({ run: () => 'ok' });

    await expect(call(h, 'ghost')).rejects.toMatchObject({
      cause: 'unknown-command',
    });
    expect(await call(h, 'run')).toEqual({ kind: 'data', value: 'ok' });
  });

  it('расширение, которого нет в наборе хоста, — unknown-command', async () => {
    const h = await start({ run: () => 1 });

    await expect(
      h.commands.invoke('acme.nobody', 'acme.nobody.run', undefined),
    ).rejects.toMatchObject({ cause: 'unknown-command' });
  });

  it('исключение обработчика — handler-failed с его текстом, в том числе синхронное', async () => {
    const h = await start({
      async: async () => {
        await Promise.resolve();
        throw new Error('async boom');
      },
      sync: () => {
        throw new Error('sync boom');
      },
    });

    await expect(call(h, 'async')).rejects.toMatchObject({
      cause: 'handler-failed',
      message: 'async boom',
    });
    await expect(call(h, 'sync')).rejects.toMatchObject({
      cause: 'handler-failed',
      message: 'sync boom',
    });
  });

  it('обработчик, не уложившийся в 10 с, — timeout; хост не перезапускается, соседние команды работают', async () => {
    const restart = vi.fn();
    const h = await open({
      candidates: [candidateOf(ID)],
      restart,
      modules: {
        [ID]: moduleOf({
          hang: () => new Promise<void>(() => {}),
          fast: () => 'ok',
        }),
      },
    });
    vi.useFakeTimers();

    const hanging = call(h, 'hang');
    const outcome = hanging.then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(9900);
    expect(await call(h, 'fast')).toEqual({ kind: 'data', value: 'ok' });
    await vi.advanceTimersByTimeAsync(200);

    expect(await outcome).toMatchObject({
      name: 'ExtensionCommandError',
      cause: 'timeout',
    });
    expect(restart).not.toHaveBeenCalled();
    expect(await call(h, 'fast')).toEqual({ kind: 'data', value: 'ok' });
  });

  it('команды идут одновременно: медленная не задерживает быструю', async () => {
    const slow = deferred();
    const h = await start({
      slow: async () => {
        await slow.promise;
        return 'slow';
      },
      fast: () => 'fast',
    });

    const pending = call(h, 'slow');
    expect(await call(h, 'fast')).toEqual({ kind: 'data', value: 'fast' });
    slow.resolve();

    expect(await pending).toEqual({ kind: 'data', value: 'slow' });
  });

  it('хост не подключён — host-down', async () => {
    const h = await start({ run: () => 1 });
    await h.channel.close();

    await expect(call(h, 'run')).rejects.toMatchObject({
      cause: 'host-down',
    });
  });
});

describe('замена набора расширений', () => {
  const build = (label: string, gate?: Promise<void>) => {
    const cleanup = vi.fn();
    const module: ServerModule = {
      server(s) {
        s.registerCommand({
          id: `${ID}.run`,
          title: 'run',
          run: async () => {
            await gate;
            return label;
          },
        });
        return cleanup;
      },
    };
    return { module, cleanup };
  };

  it('идущая команда доходит до результата старой сборки, очистка — после неё; новый вызов идёт в новую', async () => {
    const release = deferred();
    const old = build('v1', release.promise);
    const next = build('v2');
    const modules: Record<string, ServerModule> = { [ID]: old.module };
    const h = await open({ candidates: [candidateOf(ID)], modules });
    vi.useFakeTimers();
    const inFlight = call(h, 'run');
    await vi.advanceTimersByTimeAsync(0);

    modules[ID] = next.module;
    const replaced = h.replace([candidateOf(ID, { revision: 'r2' })]);
    await vi.advanceTimersByTimeAsync(10);
    expect(await call(h, 'run')).toEqual({ kind: 'data', value: 'v2' });
    expect(old.cleanup).not.toHaveBeenCalled();

    release.resolve();
    expect(await inFlight).toEqual({ kind: 'data', value: 'v1' });
    await replaced;
    await h.runtime.dispose();
    expect(old.cleanup).toHaveBeenCalledTimes(1);
  });

  it('команда, удалённая новой сборкой, перестаёт отвечать', async () => {
    const modules: Record<string, ServerModule> = {
      [ID]: moduleOf({ run: () => 'ok', gone: () => 'ok' }),
    };
    const h = await open({ candidates: [candidateOf(ID)], modules });
    await call(h, 'gone');

    modules[ID] = moduleOf({ run: () => 'ok' });
    await h.replace([candidateOf(ID, { revision: 'r2' })]);

    await expect(call(h, 'gone')).rejects.toBeInstanceOf(ExtensionCommandError);
    await expect(call(h, 'gone')).rejects.toMatchObject({
      cause: 'unknown-command',
    });
    expect(await call(h, 'run')).toEqual({ kind: 'data', value: 'ok' });
  });
});
