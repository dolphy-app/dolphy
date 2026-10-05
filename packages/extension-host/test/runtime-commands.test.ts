import { ExtensionCommandError } from '@dolphy-app/engine/ports';
import type {
  ExtensionContext,
  ExtensionModule,
} from '@dolphy-app/extension-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedExtension } from '../src/discover.ts';
import { createExtensionRuntime } from '../src/runtime.ts';
import { createLogger, deferred, nullLibrary } from './helpers.ts';
import { createHarness, stateful } from './state-harness.ts';
import type { Harness } from './state-harness.ts';

const ID = 'acme.cmd';
const PANEL = `${ID}.panel`;

let harness: Harness | null = null;
afterEach(async () => {
  vi.useRealTimers();
  await harness?.close();
  harness = null;
});

const open = (...args: Parameters<typeof createHarness>): Harness => {
  harness = createHarness(...args);
  return harness;
};

const commandsOf = (...names: string[]): ResolvedExtension['commands'] =>
  names.map((name) => ({
    id: `${ID}.${name}`,
    title: name,
    description: null,
    category: null,
    keybinding: null,
    keybindings: [],
    when: null,
    icon: 'puzzle',
    palette: true,
  }));

/** Расширение с командами `acme.cmd.<name>` и панелью `acme.cmd.panel`, без событий и настроек. */
const extensionWith = (
  names: string[],
  overrides: Partial<ResolvedExtension> = {},
): ResolvedExtension =>
  stateful(ID, {
    permissions: [],
    events: [],
    settings: [],
    commands: commandsOf(...names),
    panels: [
      {
        id: PANEL,
        title: 'Panel',
        icon: 'puzzle',
        when: null,
        rendererUrl: `dolphy-ext://${ID}/panel.mjs`,
      },
    ],
    ...overrides,
  });

type Handlers = Record<string, (args: unknown) => unknown>;

/** Модуль, регистрирующий обработчики под `acme.cmd.<name>`. */
const moduleOf = (handlers: Handlers): ExtensionModule => ({
  activate(ctx: ExtensionContext) {
    for (const [name, handler] of Object.entries(handlers)) {
      ctx.commands.register(`${ID}.${name}`, handler as never);
    }
  },
});

const start = (handlers: Handlers, names = Object.keys(handlers)) =>
  open({
    extensions: [extensionWith(names)],
    trusted: [ID],
    modules: { [ID]: moduleOf(handlers) },
  });

const call = (h: Harness, name: string, args?: unknown) =>
  h.commands.invoke(ID, `${ID}.${name}`, args as never);

describe('ctx.commands.register', () => {
  it('обработчик получает JSON-аргументы; без аргументов — undefined', async () => {
    const h = start({ echo: (args) => ({ got: args ?? 'nothing' }) });

    expect(await call(h, 'echo', { a: [1, null] })).toEqual({
      kind: 'data',
      value: { got: { a: [1, null] } },
    });
    expect(await call(h, 'echo')).toEqual({
      kind: 'data',
      value: { got: 'nothing' },
    });
  });

  it('бросает на необъявленную команду и на повторную регистрацию, ошибка называет команду', async () => {
    const errors: string[] = [];
    const h = open({
      extensions: [extensionWith(['run'])],
      trusted: [ID],
      modules: {
        [ID]: {
          activate(ctx) {
            ctx.commands.register(`${ID}.run`, () => 1);
            for (const id of [`${ID}.ghost`, `${ID}.run`]) {
              try {
                ctx.commands.register(id, () => 2);
              } catch (error) {
                errors.push((error as Error).message);
              }
            }
          },
        },
      },
    });

    expect(await call(h, 'run')).toEqual({ kind: 'data', value: 1 });
    expect(errors).toEqual([
      `command '${ID}.ghost' is not declared in the manifest of '${ID}'`,
      `command '${ID}.run' is already registered`,
    ]);
  });

  it('dispose снимает команду: следующий вызов — unknown-command', async () => {
    let registration: { dispose(): void | Promise<void> } | undefined;
    const h = open({
      extensions: [extensionWith(['run'])],
      trusted: [ID],
      modules: {
        [ID]: {
          activate(ctx) {
            registration = ctx.commands.register(`${ID}.run`, () => 1);
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

  it('активация откладывается до первого вызова и случается один раз', async () => {
    const activate = vi.fn((ctx: ExtensionContext) => {
      ctx.commands.register(`${ID}.a`, () => 'a');
      ctx.commands.register(`${ID}.b`, () => 'b');
    });
    const h = open({
      extensions: [extensionWith(['a', 'b'])],
      trusted: [ID],
      modules: { [ID]: { activate } },
    });
    expect(activate).not.toHaveBeenCalled();

    await call(h, 'a');
    await call(h, 'b');

    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('активация, бросившая ошибку, даёт handler-failed с её текстом', async () => {
    const h = open({
      extensions: [extensionWith(['run'])],
      trusted: [ID],
      modules: {
        [ID]: {
          activate: () => {
            throw new Error('boom on start');
          },
        },
      },
    });

    await expect(call(h, 'run')).rejects.toMatchObject({
      name: 'ExtensionCommandError',
      cause: 'handler-failed',
      message: 'boom on start',
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
    const h = start({ run: () => returned });

    expect(await call(h, 'run')).toEqual(expected);
  });

  it('асинхронный обработчик ждётся', async () => {
    const h = start({
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
    [
      'openPanel не на объявленную панель',
      () => ({ openPanel: 'acme.other.p' }),
    ],
    ['openPanel не строка', () => ({ openPanel: 5 })],
  ])('недопустимый результат: %s — invalid-result', async (_name, make) => {
    const h = start({ run: make as never, ok: () => 'ok' });

    await expect(call(h, 'run')).rejects.toMatchObject({
      name: 'ExtensionCommandError',
      cause: 'invalid-result',
    });
    // сбой одного вызова не ломает расширение
    expect(await call(h, 'ok')).toEqual({ kind: 'data', value: 'ok' });
  });
});

describe('сбои и таймауты', () => {
  it('неизвестная и незарегистрированная команда — unknown-command; соседняя команда работает', async () => {
    const h = open({
      extensions: [extensionWith(['run', 'unregistered'])],
      trusted: [ID],
      modules: { [ID]: moduleOf({ run: () => 'ok' }) },
    });

    await expect(call(h, 'ghost')).rejects.toMatchObject({
      cause: 'unknown-command',
    });
    await expect(call(h, 'unregistered')).rejects.toMatchObject({
      cause: 'unknown-command',
    });
    expect(await call(h, 'run')).toEqual({ kind: 'data', value: 'ok' });
  });

  it('расширение, которого нет в наборе хоста, — unknown-command', async () => {
    const h = start({ run: () => 1 });

    await expect(
      h.commands.invoke('acme.nobody', 'acme.nobody.run', undefined),
    ).rejects.toMatchObject({ cause: 'unknown-command' });
  });

  it('исключение обработчика — handler-failed с его текстом, в том числе синхронное', async () => {
    const h = start({
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
    vi.useFakeTimers();
    const restart = vi.fn();
    const h = open({
      extensions: [extensionWith(['hang', 'fast'])],
      trusted: [ID],
      restart,
      modules: {
        [ID]: moduleOf({
          hang: () => new Promise<void>(() => {}),
          fast: () => 'ok',
        }),
      },
    });

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
    const h = start({
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
    const h = start({ run: () => 1 });
    await h.channel.close();

    await expect(call(h, 'run')).rejects.toMatchObject({
      cause: 'host-down',
    });
  });
});

describe('замена набора расширений', () => {
  const build = (label: string, gate?: Promise<void>) => {
    const deactivate = vi.fn();
    const module: ExtensionModule = {
      activate(ctx) {
        ctx.commands.register(`${ID}.run`, async () => {
          await gate;
          return label;
        });
      },
      deactivate,
    };
    return { module, deactivate };
  };

  it('идущая команда доходит до результата старой сборки, deactivate — после неё; новый вызов идёт в новую', async () => {
    vi.useFakeTimers();
    const release = deferred();
    const old = build('v1', release.promise);
    const next = build('v2');
    const modules: Record<string, ExtensionModule> = { [ID]: old.module };
    const h = open({
      extensions: [extensionWith(['run'])],
      trusted: [ID],
      modules,
    });
    const inFlight = call(h, 'run');
    await vi.advanceTimersByTimeAsync(0);

    modules[ID] = next.module;
    const replaced = h.replace([extensionWith(['run'], { version: '2.0.0' })]);
    expect(await call(h, 'run')).toEqual({ kind: 'data', value: 'v2' });
    await vi.advanceTimersByTimeAsync(10);
    expect(old.deactivate).not.toHaveBeenCalled();

    release.resolve();
    expect(await inFlight).toEqual({ kind: 'data', value: 'v1' });
    await replaced;
    expect(old.deactivate).toHaveBeenCalledTimes(1);
    expect(next.deactivate).not.toHaveBeenCalled();
  });

  it('набор заменён, пока вызов ещё не дошёл до активации, — replaced, а не сбой кода', async () => {
    const runtime = createExtensionRuntime({
      extensions: [extensionWith(['run'])],
      library: nullLibrary,
      logger: createLogger(),
      modules: { [ID]: build('v1').module },
    });

    // владелец вызова определён при приёме, активация случится на следующем шаге
    const racing = runtime.handle({
      id: '1',
      method: 'invokeCommand',
      params: { extensionId: ID, commandId: `${ID}.run`, isolated: false },
    });
    await runtime.replace([extensionWith(['run'], { version: '2.0.0' })]);

    expect(await racing).toMatchObject({
      ok: false,
      error: { cause: 'replaced' },
    });
    await runtime.dispose();
  });

  it('команда, удалённая новой сборкой, перестаёт отвечать', async () => {
    const h = open({
      extensions: [extensionWith(['run', 'gone'])],
      trusted: [ID],
      modules: {
        [ID]: moduleOf({ run: () => 'ok', gone: () => 'ok' }),
      },
    });
    await call(h, 'gone');

    await h.replace([extensionWith(['run'], { version: '2.0.0' })]);

    await expect(call(h, 'gone')).rejects.toBeInstanceOf(ExtensionCommandError);
    await expect(call(h, 'gone')).rejects.toMatchObject({
      cause: 'unknown-command',
    });
  });
});
