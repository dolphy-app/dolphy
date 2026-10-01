import { PermissionError, StorageQuotaError } from '@dolphy-app/extension-api';
import type { ExtensionContext } from '@dolphy-app/extension-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEndpointPair } from '../src/loopback.ts';
import { ENGINE_REQUEST_MS } from '../src/engine-link.ts';
import { createExtensionRuntime } from '../src/runtime.ts';
import { createLogger, deferred, nullLibrary } from './helpers.ts';
import {
  attemptClosed,
  createHarness,
  sessionStarted,
  stateful,
} from './state-harness.ts';
import type { Harness } from './state-harness.ts';

const ID = 'acme.s';
const GREETING = `${ID}.greeting`;

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

/** Обработчик ждёт `open`, пока тест не вызовет `release`. */
const gate = () => {
  const { promise, resolve } = deferred();
  return { open: promise, release: resolve };
};

/** Расширение-свидетель: получает те же события; его приём показывает, что доставка дошла до этого места. */
const sentinel = (seen: string[]) => ({
  extension: stateful('acme.sentinel'),
  module: {
    activate: (ctx: ExtensionContext) => {
      ctx.events.on('attempt.closed', ({ exerciseId }) => {
        seen.push(exerciseId);
      });
    },
  },
});

describe('ctx.storage', () => {
  it('значения лежат у движка и у каждого расширения свои; превышение потолка — StorageQuotaError, запись не происходит', async () => {
    const seen: Record<string, unknown> = {};
    const h = open({
      extensions: [stateful('acme.a'), stateful('acme.b')],
      trusted: ['acme.a', 'acme.b'],
      modules: {
        'acme.a': {
          activate: async (ctx) => {
            await ctx.storage.set('k', { n: 1 });
            seen.keys = await ctx.storage.keys();
            seen.got = await ctx.storage.get('k');
            try {
              await ctx.storage.set('x'.repeat(129), 1);
            } catch (error) {
              seen.quota = error;
            }
            seen.deleted = [
              await ctx.storage.delete('missing'),
              await ctx.storage.delete('k'),
            ];
            await ctx.storage.set('kept', true);
          },
        },
        'acme.b': {
          activate: async (ctx) => {
            seen.foreign = [
              await ctx.storage.get('kept'),
              await ctx.storage.keys(),
            ];
          },
        },
      },
    });

    h.engine.emit(sessionStarted('s1'));

    await vi.waitFor(async () => {
      expect(await h.engine.read('acme.a', 'kept')).toBe(true);
      expect(seen.foreign).toBeDefined();
    });
    expect(seen).toMatchObject({
      keys: ['k'],
      got: { n: 1 },
      deleted: [false, true],
      foreign: [undefined, []],
    });
    const { quota } = seen;
    expect(quota).toBeInstanceOf(StorageQuotaError);
    expect(quota).toMatchObject({
      name: 'StorageQuotaError',
      kind: 'key-length',
      limit: 128,
    });
    expect(await h.engine.read('acme.b', 'kept')).toBeUndefined();
  });

  it('прочие отказы движка — обычный Error с кодом', async () => {
    let failure: unknown;
    const h = open({
      extensions: [stateful(ID)],
      trusted: [ID],
      modules: {
        [ID]: {
          activate: async (ctx) => {
            try {
              await ctx.storage.set('', 1);
            } catch (error) {
              failure = error;
            }
          },
        },
      },
    });
    h.engine.emit(sessionStarted('s1'));
    await vi.waitFor(() => expect(failure).toBeDefined());
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(StorageQuotaError);
    expect(failure).toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('ctx.settings', () => {
  it('get отдаёт default, затем значение пользователя; onDidChange получает изменения без перезапуска', async () => {
    const reads: unknown[] = [];
    const changes: unknown[] = [];
    let context: ExtensionContext | null = null;
    const h = open({
      extensions: [stateful(ID)],
      trusted: [ID],
      modules: {
        [ID]: {
          activate: (ctx) => {
            context = ctx;
            reads.push(ctx.settings.get(GREETING));
            ctx.settings.onDidChange((change) => changes.push(change));
          },
        },
      },
    });

    h.engine.emit(sessionStarted('s1'));
    await vi.waitFor(() => expect(context).not.toBeNull());
    expect(reads).toEqual(['hello']);

    h.engine.changeSetting({ extensionId: ID, id: GREETING, value: 'hi' });
    h.engine.changeSetting({ extensionId: ID, id: `${ID}.limit`, value: 7 });
    await vi.waitFor(() => expect(changes).toHaveLength(2));

    expect(changes).toEqual([
      { id: GREETING, value: 'hi' },
      { id: `${ID}.limit`, value: 7 },
    ]);
    const ctx = context as ExtensionContext | null;
    expect(ctx?.settings.get(GREETING)).toBe('hi');
    expect(ctx?.settings.get(`${ID}.limit`)).toBe(7);
  });

  it('значение, сохранённое до запуска, читается при активации', async () => {
    const reads: unknown[] = [];
    const h = open({
      extensions: [stateful(ID)],
      trusted: [ID],
      modules: {
        [ID]: {
          activate: (ctx) => void reads.push(ctx.settings.get(GREETING)),
        },
      },
    });
    h.engine.changeSetting({ extensionId: ID, id: GREETING, value: 'saved' });

    h.engine.emit(sessionStarted('s1'));

    await vi.waitFor(() => expect(reads).toEqual(['saved']));
  });

  it('чужой id, то же значение и сбой обработчика не мешают; неизвестный id при чтении бросает', async () => {
    const calls: unknown[] = [];
    let ctx: ExtensionContext | null = null;
    const h = open({
      extensions: [stateful(ID)],
      trusted: [ID],
      modules: {
        [ID]: {
          activate: (context) => {
            ctx = context;
            context.settings.onDidChange(() => {
              throw new Error('boom');
            });
            context.settings.onDidChange((change) => calls.push(change));
          },
        },
      },
    });
    h.engine.emit(sessionStarted('s1'));
    await vi.waitFor(() => expect(ctx).not.toBeNull());

    h.engine.changeSetting({ extensionId: ID, id: 'acme.other.x', value: 1 });
    h.engine.changeSetting({ extensionId: ID, id: GREETING, value: 'hello' });
    h.engine.changeSetting({ extensionId: ID, id: GREETING, value: 'hey' });

    await vi.waitFor(() =>
      expect(calls).toEqual([{ id: GREETING, value: 'hey' }]),
    );
    expect(h.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ settingId: GREETING }),
      'setting change handler failed',
    );
    expect(() =>
      (ctx as ExtensionContext | null)?.settings.get('nope'),
    ).toThrow(/not declared/);
  });

  it('не загрузились значения — расширение работает со значениями по умолчанию, в лог предупреждение', async () => {
    const reads: unknown[] = [];
    const h = open({
      extensions: [stateful(ID)],
      trusted: [ID],
      modules: {
        [ID]: {
          activate: (ctx) => void reads.push(ctx.settings.get(GREETING)),
        },
      },
    });
    h.engine.changeSetting({ extensionId: ID, id: GREETING, value: 'saved' });
    vi.spyOn(h.engine.extensionHost.settings, 'all').mockRejectedValue(
      new Error('db is busy'),
    );

    h.engine.emit(sessionStarted('s1'));

    await vi.waitFor(() => expect(reads).toEqual(['hello']));
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ extensionId: ID }),
      'extension settings were not loaded, defaults are used',
    );
  });
});

describe('ctx.events', () => {
  it('подписка требует разрешения, объявления события и бывает одна на событие', async () => {
    const errors: Record<string, unknown> = {};
    const h = open({
      extensions: [
        stateful('acme.np', {
          permissions: [],
          events: [],
          exerciseTypes: [
            {
              id: 'acme.np',
              specSchema: {},
              answerSchema: {},
              element: 'acme-np-answer',
              rendererUrl: 'dolphy-ext://acme.np/view.mjs',
            },
          ],
        }),
        stateful(ID),
      ],
      trusted: ['acme.np', ID],
      modules: {
        'acme.np': {
          activate: (ctx) => {
            try {
              ctx.events.on('session.started', () => {});
            } catch (error) {
              errors.permission = error;
            }
            ctx.registerExerciseType('acme.np', {
              project: () => ({}),
              grade: () => ({ outcome: 'passed' }),
            });
          },
        },
        [ID]: {
          activate: (ctx) => {
            try {
              ctx.events.on('session.finished', () => {});
            } catch (error) {
              errors.undeclared = error;
            }
            const first = ctx.events.on('attempt.closed', () => {});
            try {
              ctx.events.on('attempt.closed', () => {});
            } catch (error) {
              errors.duplicate = error;
            }
            void first.dispose();
            // после отписки событие снова можно занять
            ctx.events.on('attempt.closed', () => {});
            errors.done = true;
          },
        },
      },
    });

    await h.runtime.handle({
      id: '1',
      method: 'project',
      params: { type: 'acme.np', exerciseId: 'e', spec: {}, isolated: false },
    });
    h.engine.emit(sessionStarted('s1'));
    await vi.waitFor(() => expect(errors.done).toBe(true));

    expect(errors.permission).toBeInstanceOf(PermissionError);
    expect(errors.permission).toMatchObject({ permission: 'learning.events' });
    expect(errors.undeclared).toMatchObject({
      message: expect.stringContaining("'session.finished' is not declared"),
    });
    expect(errors.duplicate).toMatchObject({
      message: expect.stringContaining('already subscribed'),
    });
  });

  it('первое событие лениво активирует расширение; события одного расширения приходят по порядку, по одному разу', async () => {
    const order: string[] = [];
    const slow = gate();
    const activate = vi.fn((ctx: ExtensionContext) => {
      ctx.events.on('attempt.closed', async ({ exerciseId }) => {
        // первый обработчик медленнее остальных: порядок обеспечивает доставка, а не скорость
        if (exerciseId === 'e1') await slow.open;
        order.push(exerciseId);
      });
    });
    const h = open({
      extensions: [stateful(ID)],
      trusted: [ID],
      modules: { [ID]: { activate } },
    });
    expect(activate).not.toHaveBeenCalled();

    for (const id of ['e1', 'e2', 'e3']) h.engine.emit(attemptClosed(id));
    slow.release();

    await vi.waitFor(() => expect(order).toEqual(['e1', 'e2', 'e3']));
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('событие, которого расширение не объявило, и расширение без подписки не активируют код', async () => {
    const activate = vi.fn();
    const quiet = vi.fn();
    const h = open({
      extensions: [
        stateful(ID, { events: [{ event: 'session.started' }] }),
        stateful('acme.quiet'),
      ],
      trusted: [ID, 'acme.quiet'],
      modules: {
        [ID]: { activate },
        'acme.quiet': { activate: quiet },
      },
    });

    h.engine.emit(attemptClosed('e1'));
    h.engine.emit({
      name: 'session.finished',
      payload: { sessionId: 's', at: 1 },
    });

    // единственный подписчик на `attempt.closed` — acme.quiet; он активируется, но не подписывается
    await vi.waitFor(() => expect(quiet).toHaveBeenCalledTimes(1));
    expect(activate).not.toHaveBeenCalled();
  });

  it('отключённое расширение событий не получает', async () => {
    const seen: string[] = [];
    const h = open({
      extensions: [stateful(ID)],
      trusted: [ID],
      modules: {
        [ID]: {
          activate: (ctx) => {
            ctx.events.on('attempt.closed', ({ exerciseId }) => {
              seen.push(exerciseId);
            });
          },
        },
      },
    });
    h.engine.emit(attemptClosed('on'));
    await vi.waitFor(() => expect(seen).toEqual(['on']));

    h.policy.update({ disabled: [ID], trusted: [ID], checkUpdates: true });
    h.engine.emit(attemptClosed('off'));
    h.policy.update({ disabled: [], trusted: [ID], checkUpdates: true });
    h.engine.emit(attemptClosed('on-again'));

    await vi.waitFor(() => expect(seen).toEqual(['on', 'on-again']));
  });

  it('исключение обработчика не мешает следующим событиям, перезапуск хоста не взводится', async () => {
    const seen: string[] = [];
    const restart = vi.fn();
    const h = open({
      extensions: [stateful(ID)],
      trusted: [ID],
      restart,
      modules: {
        [ID]: {
          activate: (ctx) => {
            ctx.events.on('attempt.closed', ({ exerciseId }) => {
              if (exerciseId === 'bad') throw new Error('handler bug');
              seen.push(exerciseId);
            });
          },
        },
      },
    });

    h.engine.emit(attemptClosed('bad'));
    h.engine.emit(attemptClosed('good'));

    await vi.waitFor(() => expect(seen).toEqual(['good']));
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionId: ID,
        event: 'attempt.closed',
        cause: 'handler-failed',
        message: 'handler bug',
      }),
      'extension event handler failed',
    );
    expect(restart).not.toHaveBeenCalled();
  });

  it('обработчик дольше 2 с отбрасывается, следующее событие идёт дальше; перезапуск хоста не взводится', async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const restart = vi.fn();
    const h = open({
      extensions: [stateful(ID)],
      trusted: [ID],
      restart,
      modules: {
        [ID]: {
          activate: (ctx) => {
            ctx.events.on('attempt.closed', async ({ exerciseId }) => {
              // завис навсегда: промис не завершается
              if (exerciseId === 'hang') await new Promise<void>(() => {});
              seen.push(exerciseId);
            });
          },
        },
      },
    });

    h.engine.emit(attemptClosed('hang'));
    h.engine.emit(attemptClosed('next'));
    await vi.advanceTimersByTimeAsync(1900);
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);

    expect(seen).toEqual(['next']);
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'handler-failed' }),
      'extension event handler failed',
    );
    expect(restart).not.toHaveBeenCalled();
  });

  it('очередь расширения — 100 событий: при переполнении отбрасываются самые старые, в лог предупреждение', async () => {
    const seen: string[] = [];
    const blocker = gate();
    const h = open({
      extensions: [stateful(ID)],
      trusted: [ID],
      queueLimit: 3,
      modules: {
        [ID]: {
          activate: (ctx) => {
            ctx.events.on('attempt.closed', async ({ exerciseId }) => {
              await blocker.open;
              seen.push(exerciseId);
            });
          },
        },
      },
    });

    for (let i = 1; i <= 6; i++) h.engine.emit(attemptClosed(`e${i}`));
    blocker.release();

    // e1 уже в обработке; из e2..e6 остаются три последних
    await vi.waitFor(() => expect(seen).toEqual(['e1', 'e4', 'e5', 'e6']));
    const overflow = h.logger.warn.mock.calls.filter(
      ([, message]) =>
        message ===
        'extension event queue overflow, the oldest event is dropped',
    );
    expect(overflow.map(([fields]) => fields)).toMatchObject([
      { extensionId: ID, event: 'attempt.closed', limit: 3 },
      { extensionId: ID, event: 'attempt.closed', limit: 3 },
    ]);
  });

  it('сбой активации не роняет доставку: другое расширение получает события, перезапуска нет', async () => {
    const seen: string[] = [];
    const restart = vi.fn();
    const h = open({
      extensions: [stateful('acme.broken'), stateful(ID)],
      trusted: ['acme.broken', ID],
      restart,
      modules: {
        'acme.broken': {
          activate: () => {
            throw new Error('cannot start');
          },
        },
        [ID]: {
          activate: (ctx) => {
            ctx.events.on('attempt.closed', ({ exerciseId }) => {
              seen.push(exerciseId);
            });
          },
        },
      },
    });

    h.engine.emit(attemptClosed('e1'));
    h.engine.emit(attemptClosed('e2'));

    await vi.waitFor(() => expect(seen).toEqual(['e1', 'e2']));
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionId: 'acme.broken',
        cause: 'activation-failed',
      }),
      'extension event handler failed',
    );
    expect(restart).not.toHaveBeenCalled();
  });

  it('замена набора: накопленные события удалённого расширения отбрасываются, его активация закрыта', async () => {
    const seen: string[] = [];
    const watched: string[] = [];
    const blocker = gate();
    const entered = deferred();
    const deactivate = vi.fn();
    const witness = sentinel(watched);
    const h = open({
      extensions: [stateful(ID), witness.extension],
      trusted: [ID, 'acme.sentinel'],
      modules: {
        [ID]: {
          activate: (ctx) => {
            ctx.events.on('attempt.closed', async ({ exerciseId }) => {
              entered.resolve();
              await blocker.open;
              seen.push(exerciseId);
            });
          },
          deactivate,
        },
        'acme.sentinel': witness.module,
      },
    });
    for (const id of ['e1', 'e2', 'e3']) h.engine.emit(attemptClosed(id));
    await entered.promise;

    const replaced = h.replace([witness.extension]);
    blocker.release();
    await replaced;
    h.engine.emit(attemptClosed('after'));
    await vi.waitFor(() =>
      expect(watched).toEqual(['e1', 'e2', 'e3', 'after']),
    );

    expect(deactivate).toHaveBeenCalledTimes(1);
    // e1 был в обработке; e2 и e3 стояли в очереди удалённого расширения
    expect(seen).toEqual(['e1']);
  });

  it('обновление расширения: старый обработчик снят, событие приходит один раз', async () => {
    const seen: string[] = [];
    const h = open({
      extensions: [stateful(ID)],
      trusted: [ID],
      modules: {
        [ID]: {
          activate: (ctx) => {
            ctx.events.on('attempt.closed', ({ exerciseId }) => {
              seen.push(exerciseId);
            });
          },
        },
      },
    });
    h.engine.emit(attemptClosed('before'));
    await vi.waitFor(() => expect(seen).toEqual(['before']));

    await h.replace([stateful(ID, { version: '2.0.0' })]);
    h.engine.emit(attemptClosed('after'));

    await vi.waitFor(() => expect(seen).toContain('after'));
    expect(seen).toEqual(['before', 'after']);
  });
});

describe('запросы хоста к движку', () => {
  const requestingModule = (outcome: { error?: unknown }) => ({
    activate: async (ctx: ExtensionContext) => {
      try {
        await ctx.storage.get('k');
      } catch (error) {
        outcome.error = error;
      }
    },
  });
  const deliver = {
    id: '1',
    method: 'deliverEvent' as const,
    params: {
      extensionId: ID,
      name: 'session.started' as const,
      payload: { sessionId: 's', at: 1 },
      isolated: false,
    },
  };

  it('закрытие соединения отклоняет ожидающие запросы', async () => {
    const outcome: { error?: unknown } = {};
    const [engineSide, hostSide] = createEndpointPair();
    const runtime = createExtensionRuntime({
      extensions: [stateful(ID, { settings: [] })],
      library: nullLibrary,
      logger: createLogger(),
      modules: { [ID]: requestingModule(outcome) },
    });
    runtime.attach(hostSide);
    const requests: unknown[] = [];
    engineSide.onMessage((message) => requests.push(message));

    engineSide.post(deliver);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    engineSide.close();

    await vi.waitFor(() => expect(outcome.error).toBeDefined());
    expect(outcome.error).toMatchObject({ code: 'UNAVAILABLE' });
    await runtime.dispose();
  });

  it('молчащий движок: запрос отклоняется по сроку, хост это не перезапускает', async () => {
    vi.useFakeTimers();
    const outcome: { error?: unknown } = {};
    const [engineSide, hostSide] = createEndpointPair();
    const runtime = createExtensionRuntime({
      extensions: [stateful(ID, { settings: [] })],
      library: nullLibrary,
      logger: createLogger(),
      modules: { [ID]: requestingModule(outcome) },
    });
    runtime.attach(hostSide);
    engineSide.onMessage(() => {});

    engineSide.post(deliver);
    await vi.advanceTimersByTimeAsync(ENGINE_REQUEST_MS - 1);
    expect(outcome.error).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2);

    expect(outcome.error).toMatchObject({ code: 'TIMEOUT' });
    await runtime.dispose();
  });
});
