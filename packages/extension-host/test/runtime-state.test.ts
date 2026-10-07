import {
  NotificationRateLimitError,
  SecretsUnavailableError,
  StorageQuotaError,
} from '@dolphy-app/extension-api';
import type { ServerContext } from '@dolphy-app/extension-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEndpointPair } from '../src/loopback.ts';
import { ENGINE_REQUEST_MS, EngineRequestError } from '../src/engine-link.ts';
import type { HostFailure as EngineRequestFailure } from '../src/protocol.ts';
import {
  createExtensionNotifications,
  createExtensionStats,
} from '../src/state.ts';
import { createExtensionRuntime } from '../src/runtime.ts';
import type { ServerModule } from '../src/runtime.ts';
import { candidateOf, createLogger, deferred, nullLibrary } from './helpers.ts';
import {
  attemptClosed,
  createHarness,
  statefulSettings,
} from './state-harness.ts';
import type { Harness } from './state-harness.ts';

const ID = 'acme.s';
const GREETING = `${ID}.greeting`;
const LIMIT = `${ID}.limit`;
const TAGS = `${ID}.tags`;

let harness: Harness | null = null;
/** Контексты, которые получил `server` каждого расширения: последняя загрузка перекрывает прежнюю. */
const contexts = new Map<string, ServerContext>();
afterEach(async () => {
  vi.useRealTimers();
  contexts.clear();
  await harness?.close();
  harness = null;
});

const open = async (
  ...args: Parameters<typeof createHarness>
): Promise<Harness> => {
  harness = await createHarness(...args);
  return harness;
};

/** Контекст расширения, как его получил `server`. */
const ctxOf = (id: string): ServerContext => {
  const context = contexts.get(id);
  if (context === undefined) throw new Error(`server of '${id}' did not run`);
  return context;
};

/** Модуль, который только запоминает контекст; `extra` регистрирует вклады. */
const exposing = (
  id: string,
  extra: (s: ServerContext) => void = () => {},
): ServerModule => ({
  server: (s) => {
    contexts.set(id, s);
    extra(s);
  },
});

/** Расширение с настройками `statefulSettings` и подпиской на `attempt.closed`. */
const withSettings = (s: ServerContext): void => {
  s.registerSettings(statefulSettings(ID));
};

/** Обработчик ждёт `open`, пока тест не вызовет `release`. */
const gate = () => {
  const { promise, resolve } = deferred();
  return { open: promise, release: resolve };
};

const POLICY_ALLOWING = {
  checkUpdates: true,
  safeMode: false,
  notificationsOff: [],
  catalogUrl: null,
  schedulesOff: [],
};

describe('s.logger', () => {
  it('записи расширения несут его extensionId; чужой id в полях записи его не подменяет', async () => {
    const h = await open({
      candidates: [candidateOf('acme.a')],
      modules: {
        'acme.a': {
          server: (s) => {
            s.logger.info({ n: 1 }, 'hello');
            s.logger.warn({ extensionId: 'acme.other' }, 'spoof');
            s.logger.error({}, 'plain');
            s.logger.debug({ n: 2 });
          },
        },
      },
    });

    expect(h.logger.info).toHaveBeenCalledWith(
      { n: 1, extensionId: 'acme.a' },
      'hello',
    );
    expect(h.logger.warn).toHaveBeenCalledWith(
      { extensionId: 'acme.a' },
      'spoof',
    );
    expect(h.logger.error).toHaveBeenCalledWith(
      { extensionId: 'acme.a' },
      'plain',
    );
    expect(h.logger.debug).toHaveBeenCalledWith(
      { n: 2, extensionId: 'acme.a' },
      undefined,
    );
  });
});

describe('s.secrets', () => {
  it('значения у каждого расширения свои; без хранилища ключей запись и чтение существующего ключа — SecretsUnavailableError, а чтение отсутствующего и удаление работают', async () => {
    const h = await open({
      candidates: [candidateOf('acme.a'), candidateOf('acme.b')],
      modules: { 'acme.a': exposing('acme.a'), 'acme.b': exposing('acme.b') },
    });
    const a = ctxOf('acme.a');
    const failure = async (run: () => Promise<unknown>) => {
      try {
        await run();
      } catch (error) {
        return error;
      }
      return null;
    };

    await a.secrets.set('token', 's3cret');
    const got = await a.secrets.get('token');
    const missing = await a.secrets.get('nope');
    const deletedMissing = await a.secrets.delete('nope');
    h.engine.keyStore.available = false;
    const setError = await failure(() => a.secrets.set('x', 'y'));
    const getError = await failure(() => a.secrets.get('token'));
    const missingWhileDown = await a.secrets.get('nope');
    const deleted = await a.secrets.delete('token');
    const foreign = await ctxOf('acme.b').secrets.get('token');

    expect({ got, missing, deletedMissing, missingWhileDown, deleted }).toEqual(
      {
        got: 's3cret',
        missing: undefined,
        deletedMissing: false,
        missingWhileDown: undefined,
        deleted: true,
      },
    );
    expect(foreign).toBeUndefined();
    for (const error of [setError, getError]) {
      expect(error).toBeInstanceOf(SecretsUnavailableError);
      expect(error).toMatchObject({
        name: 'SecretsUnavailable',
        code: 'SECRETS_UNAVAILABLE',
      });
    }
    expect(await h.engine.readSecret('acme.a', 'token')).toBeUndefined();
  });
});

describe('s.storage', () => {
  it('значения лежат у движка и у каждого расширения свои; превышение потолка — StorageQuotaError, запись не происходит', async () => {
    const h = await open({
      candidates: [candidateOf('acme.a'), candidateOf('acme.b')],
      modules: { 'acme.a': exposing('acme.a'), 'acme.b': exposing('acme.b') },
    });
    const a = ctxOf('acme.a').storage;

    await a.set('k', { n: 1 });
    const keys = await a.keys();
    const got = await a.get('k');
    const quota = await a.set('x'.repeat(129), 1).catch((error) => error);
    const deleted = [await a.delete('missing'), await a.delete('k')];
    await a.set('kept', true);
    const foreign = [
      await ctxOf('acme.b').storage.get('kept'),
      await ctxOf('acme.b').storage.keys(),
    ];

    expect({ keys, got, deleted, foreign }).toEqual({
      keys: ['k'],
      got: { n: 1 },
      deleted: [false, true],
      foreign: [undefined, []],
    });
    expect(quota).toBeInstanceOf(StorageQuotaError);
    expect(quota).toMatchObject({
      name: 'StorageQuotaError',
      kind: 'key-length',
      limit: 128,
    });
    expect(await h.engine.read('acme.a', 'kept')).toBe(true);
    expect(await h.engine.read('acme.b', 'kept')).toBeUndefined();
  });

  it('прочие отказы движка — обычный Error с кодом', async () => {
    await open({
      candidates: [candidateOf(ID)],
      modules: { [ID]: exposing(ID) },
    });

    const failure = await ctxOf(ID)
      .storage.set('', 1)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(StorageQuotaError);
    expect(failure).toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('s.stats', () => {
  it('запросы идут движку от имени расширения; courseId, которого нет, в запрос не попадает', async () => {
    const h = await open({
      candidates: [candidateOf(ID)],
      modules: { [ID]: exposing(ID) },
    });
    const { stats } = ctxOf(ID);

    const streak = await stats.streak();
    await stats.streak({ courseId: 'alpha' });
    const daily = await stats.daily({
      from: '2024-05-01',
      to: '2024-05-02',
      courseId: 'alpha',
    });
    await stats.daily({ from: '2024-05-01', to: '2024-05-02' });

    expect(streak).toEqual({ current: 3, longest: 7 });
    expect(daily).toEqual([
      { date: '2024-05-01', attempts: 2, correct: 1, accuracy: 0.5 },
    ]);
    expect(h.engine.statsCalls).toEqual([
      { extensionId: ID, method: 'streak', args: [] },
      { extensionId: ID, method: 'streak', args: ['alpha'] },
      {
        extensionId: ID,
        method: 'daily',
        args: ['2024-05-01', '2024-05-02', 'alpha'],
      },
      { extensionId: ID, method: 'daily', args: ['2024-05-01', '2024-05-02'] },
    ]);
  });

  it('отказ движка становится Error с кодом', async () => {
    const reject = (failure: EngineRequestFailure) => ({
      request: async () => {
        throw new EngineRequestError(failure);
      },
    });
    const invalid = createExtensionStats(
      reject({
        code: 'INVALID_ARGUMENT',
        message: 'bad range',
        details: { field: 'to' },
      }),
      ID,
    );
    const failure = await invalid
      .daily({ from: '2024-05-02', to: '2024-05-01' })
      .catch((reason: unknown) => reason);
    expect(failure).toMatchObject({
      message: 'bad range',
      code: 'INVALID_ARGUMENT',
    });
  });
});

describe('s.notifications', () => {
  it('show идёт движку от имени расширения и возвращает его ответ', async () => {
    const h = await open({
      candidates: [candidateOf(ID)],
      modules: { [ID]: exposing(ID) },
    });
    const { notifications } = ctxOf(ID);

    const first = await notifications.show({ title: 'T', body: 'B' });
    h.engine.notifier.shown = false;
    const second = await notifications.show({ title: 'T2', body: '' });

    expect([first, second]).toEqual([true, false]);
    expect(h.engine.notified).toEqual([
      { extensionId: ID, title: 'T', body: 'B' },
      { extensionId: ID, title: 'T2', body: '' },
    ]);
  });

  it('отказы движка: предел частоты — NotificationRateLimitError, остальное — Error с кодом', async () => {
    const reject = (failure: EngineRequestFailure) =>
      createExtensionNotifications(
        {
          request: async () => {
            throw new EngineRequestError(failure);
          },
        },
        ID,
      );
    const note = { title: 'T', body: 'B' };

    const limited = await reject({
      code: 'INVALID_ARGUMENT',
      message: 'too many',
      details: { reason: 'rate-limit', window: 'hour', limit: 30 },
    })
      .show(note)
      .catch((reason: unknown) => reason);
    expect(limited).toBeInstanceOf(NotificationRateLimitError);
    expect(limited).toMatchObject({ window: 'hour', limit: 30 });

    const invalid = await reject({
      code: 'INVALID_ARGUMENT',
      message: 'title is too long',
      details: { field: 'title', max: 80 },
    })
      .show(note)
      .catch((reason: unknown) => reason);
    expect(invalid).not.toBeInstanceOf(NotificationRateLimitError);
    expect(invalid).toMatchObject({
      message: 'title is too long',
      code: 'INVALID_ARGUMENT',
    });
  });
});

describe('s.settings', () => {
  it('внутри server get отдаёт default; затем значение пользователя; onDidChange получает изменения без перезапуска', async () => {
    const reads: unknown[] = [];
    const changes: unknown[] = [];
    const h = await open({
      candidates: [candidateOf(ID)],
      modules: {
        [ID]: exposing(ID, (s) => {
          withSettings(s);
          reads.push(s.settings.get(GREETING));
          s.settings.onDidChange((change) => changes.push(change));
        }),
      },
    });
    expect(reads).toEqual(['hello']);

    h.engine.changeSetting({ extensionId: ID, id: GREETING, value: 'hi' });
    h.engine.changeSetting({ extensionId: ID, id: LIMIT, value: 7 });
    await vi.waitFor(() => expect(changes).toHaveLength(2));

    expect(changes).toEqual([
      { id: GREETING, value: 'hi' },
      { id: LIMIT, value: 7 },
    ]);
    expect(ctxOf(ID).settings.get(GREETING)).toBe('hi');
    expect(ctxOf(ID).settings.get(LIMIT)).toBe(7);
  });

  it('список: get отдаёт копию, равный список не событие, значение не того типа игнорируется', async () => {
    const calls: unknown[] = [];
    const h = await open({
      candidates: [candidateOf(ID)],
      modules: {
        [ID]: exposing(ID, (s) => {
          withSettings(s);
          s.settings.onDidChange((change) => calls.push(change));
        }),
      },
    });
    const { settings } = ctxOf(ID);

    const first = settings.get(TAGS) as string[];
    first.push('mutated');
    expect(settings.get(TAGS)).toEqual(['a']);

    h.engine.changeSetting({ extensionId: ID, id: TAGS, value: ['a'] });
    h.engine.changeSetting({ extensionId: ID, id: TAGS, value: [1] as never });
    h.engine.changeSetting({ extensionId: ID, id: TAGS, value: 'a' });
    h.engine.changeSetting({ extensionId: ID, id: TAGS, value: ['b', 'a'] });

    await vi.waitFor(() =>
      expect(calls).toEqual([{ id: TAGS, value: ['b', 'a'] }]),
    );
    expect(settings.get(TAGS)).toEqual(['b', 'a']);
  });

  it('значение, сохранённое до запуска, подгружается после server: внутри него default, после — сохранённое', async () => {
    const reads: unknown[] = [];
    const h = await open({
      candidates: [candidateOf(ID)],
      modules: {
        [ID]: exposing(ID, (s) => {
          withSettings(s);
          reads.push(s.settings.get(GREETING));
        }),
      },
    });
    h.engine.changeSetting({ extensionId: ID, id: GREETING, value: 'saved' });

    await h.replace([candidateOf(ID, { revision: 'r2' })]);

    expect(reads).toEqual(['hello', 'hello']);
    expect(ctxOf(ID).settings.get(GREETING)).toBe('saved');
  });

  it('чужой id, то же значение и сбой обработчика не мешают; неизвестный id при чтении бросает', async () => {
    const calls: unknown[] = [];
    const h = await open({
      candidates: [candidateOf(ID)],
      modules: {
        [ID]: exposing(ID, (s) => {
          withSettings(s);
          s.settings.onDidChange(() => {
            throw new Error('boom');
          });
          s.settings.onDidChange((change) => calls.push(change));
        }),
      },
    });

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
    expect(() => ctxOf(ID).settings.get('nope')).toThrow(/not registered/);
  });

  it('не загрузились значения — расширение работает со значениями по умолчанию, в лог предупреждение', async () => {
    const h = await open({
      candidates: [candidateOf(ID)],
      modules: { [ID]: exposing(ID, withSettings) },
    });
    h.engine.changeSetting({ extensionId: ID, id: GREETING, value: 'saved' });
    vi.spyOn(h.engine.extensionHost.settings, 'all').mockRejectedValue(
      new Error('db is busy'),
    );

    await h.replace([candidateOf(ID, { revision: 'r2' })]);

    expect(ctxOf(ID).settings.get(GREETING)).toBe('hello');
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ extensionId: ID }),
      'extension settings were not loaded, defaults are used',
    );
  });
});

describe('s.on', () => {
  it('неизвестное событие и вторая подписка на событие бросают; после dispose событие снова можно занять', async () => {
    const errors: Record<string, unknown> = {};
    await open({
      candidates: [candidateOf(ID)],
      modules: {
        [ID]: {
          server: (s) => {
            try {
              s.on('session.unknown' as never, () => {});
            } catch (error) {
              errors.unknown = error;
            }
            const first = s.on('attempt.closed', () => {});
            try {
              s.on('attempt.closed', () => {});
            } catch (error) {
              errors.duplicate = error;
            }
            void first.dispose();
            s.on('attempt.closed', () => {});
            errors.done = true;
          },
        },
      },
    });

    expect(errors.done).toBe(true);
    expect(errors.unknown).toMatchObject({
      message: expect.stringContaining('unknown learning event'),
    });
    expect(errors.duplicate).toMatchObject({
      message: expect.stringContaining('already subscribed'),
    });
  });

  it('server вызывается один раз; события одного расширения приходят по порядку, по одному разу', async () => {
    const order: string[] = [];
    const slow = gate();
    const server = vi.fn((s: ServerContext) => {
      s.on('attempt.closed', async ({ exerciseId }) => {
        // первый обработчик медленнее остальных: порядок обеспечивает доставка, а не скорость
        if (exerciseId === 'e1') await slow.open;
        order.push(exerciseId);
      });
    });
    const h = await open({
      candidates: [candidateOf(ID)],
      modules: { [ID]: { server } },
    });

    for (const id of ['e1', 'e2', 'e3']) h.engine.emit(attemptClosed(id));
    slow.release();

    await vi.waitFor(() => expect(order).toEqual(['e1', 'e2', 'e3']));
    expect(server).toHaveBeenCalledTimes(1);
  });

  it('событие получает только подписанное на него расширение', async () => {
    const started = vi.fn();
    const closed: string[] = [];
    const h = await open({
      candidates: [candidateOf(ID), candidateOf('acme.quiet')],
      modules: {
        [ID]: { server: (s) => void s.on('session.started', started) },
        'acme.quiet': {
          server: (s) =>
            void s.on('attempt.closed', ({ exerciseId }) => {
              closed.push(exerciseId);
            }),
        },
      },
    });

    h.engine.emit(attemptClosed('e1'));
    h.engine.emit({
      name: 'session.finished',
      payload: { sessionId: 's', at: 1 },
    });

    await vi.waitFor(() => expect(closed).toEqual(['e1']));
    expect(started).not.toHaveBeenCalled();
  });

  it('отключённое расширение событий не получает', async () => {
    const seen: string[] = [];
    const h = await open({
      candidates: [candidateOf(ID)],
      modules: {
        [ID]: {
          server: (s) => {
            s.on('attempt.closed', ({ exerciseId }) => {
              seen.push(exerciseId);
            });
          },
        },
      },
    });
    h.engine.emit(attemptClosed('on'));
    await vi.waitFor(() => expect(seen).toEqual(['on']));

    h.policy.update({ ...POLICY_ALLOWING, disabled: [ID] });
    h.engine.emit(attemptClosed('off'));
    h.policy.update({ ...POLICY_ALLOWING, disabled: [] });
    h.engine.emit(attemptClosed('on-again'));

    await vi.waitFor(() => expect(seen).toEqual(['on', 'on-again']));
  });

  it('исключение обработчика не мешает следующим событиям, перезапуск хоста не взводится', async () => {
    const seen: string[] = [];
    const restart = vi.fn();
    const h = await open({
      candidates: [candidateOf(ID)],
      restart,
      modules: {
        [ID]: {
          server: (s) => {
            s.on('attempt.closed', ({ exerciseId }) => {
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
    const seen: string[] = [];
    const restart = vi.fn();
    const h = await open({
      candidates: [candidateOf(ID)],
      restart,
      modules: {
        [ID]: {
          server: (s) => {
            s.on('attempt.closed', async ({ exerciseId }) => {
              // завис навсегда: промис не завершается
              if (exerciseId === 'hang') await new Promise<void>(() => {});
              seen.push(exerciseId);
            });
          },
        },
      },
    });
    vi.useFakeTimers();

    h.engine.emit(attemptClosed('hang'));
    h.engine.emit(attemptClosed('next'));
    await vi.advanceTimersByTimeAsync(1900);
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);

    expect(seen).toEqual(['next']);
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'handler-timeout' }),
      'extension event handler failed',
    );
    expect(restart).not.toHaveBeenCalled();
  });

  it('очередь расширения ограничена: при переполнении отбрасываются самые старые, в лог предупреждение', async () => {
    const seen: string[] = [];
    const blocker = gate();
    const h = await open({
      candidates: [candidateOf(ID)],
      queueLimit: 3,
      modules: {
        [ID]: {
          server: (s) => {
            s.on('attempt.closed', async ({ exerciseId }) => {
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

  it('сбой server не роняет доставку: другое расширение получает события, перезапуска нет', async () => {
    const seen: string[] = [];
    const restart = vi.fn();
    const h = await open({
      candidates: [candidateOf('acme.broken'), candidateOf(ID)],
      restart,
      modules: {
        'acme.broken': {
          server: () => {
            throw new Error('cannot start');
          },
        },
        [ID]: {
          server: (s) => {
            s.on('attempt.closed', ({ exerciseId }) => {
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
      'extension registration failed',
    );
    expect(restart).not.toHaveBeenCalled();
  });

  it('замена набора: накопленные события удалённого расширения отбрасываются, его очистка вызвана', async () => {
    const seen: string[] = [];
    const watched: string[] = [];
    const blocker = gate();
    const entered = deferred();
    const cleanup = vi.fn();
    const h = await open({
      candidates: [candidateOf(ID), candidateOf('acme.sentinel')],
      modules: {
        [ID]: {
          server: (s) => {
            s.on('attempt.closed', async ({ exerciseId }) => {
              entered.resolve();
              await blocker.open;
              seen.push(exerciseId);
            });
            return cleanup;
          },
        },
        'acme.sentinel': {
          server: (s) => {
            s.on('attempt.closed', ({ exerciseId }) => {
              watched.push(exerciseId);
            });
          },
        },
      },
    });
    for (const id of ['e1', 'e2', 'e3']) h.engine.emit(attemptClosed(id));
    await entered.promise;

    const replaced = h.replace([candidateOf('acme.sentinel')]);
    blocker.release();
    await replaced;
    h.engine.emit(attemptClosed('after'));
    await vi.waitFor(() => expect(watched).toContain('after'));

    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
    // e1 был в обработке; e2 и e3 стояли в очереди удалённого расширения
    expect(seen).toEqual(['e1']);
  });

  it('обновление расширения: старый обработчик снят, событие приходит один раз', async () => {
    const seen: string[] = [];
    const h = await open({
      candidates: [candidateOf(ID)],
      modules: {
        [ID]: {
          server: (s) => {
            s.on('attempt.closed', ({ exerciseId }) => {
              seen.push(exerciseId);
            });
          },
        },
      },
    });
    h.engine.emit(attemptClosed('before'));
    await vi.waitFor(() => expect(seen).toEqual(['before']));

    await h.replace([candidateOf(ID, { revision: 'r2' })]);
    h.engine.emit(attemptClosed('after'));

    await vi.waitFor(() => expect(seen).toContain('after'));
    expect(seen).toEqual(['before', 'after']);
  });
});

describe('запросы хоста к движку', () => {
  /** Хост без движка-заглушки: движок — конец канала, которым управляет тест. */
  const bare = async () => {
    const [engineSide, hostSide] = createEndpointPair();
    let context: ServerContext | undefined;
    const runtime = createExtensionRuntime({
      library: nullLibrary,
      logger: createLogger(),
      modules: {
        [ID]: {
          server: (s) => {
            context = s;
          },
        },
      },
    });
    runtime.attach(hostSide);
    await runtime.replace([candidateOf(ID)]);
    return { engineSide, runtime, storage: (context as ServerContext).storage };
  };

  it('закрытие соединения отклоняет ожидающие запросы', async () => {
    const { engineSide, runtime, storage } = await bare();
    const requests: unknown[] = [];
    engineSide.onMessage((message) => requests.push(message));

    const pending = storage.get('k').catch((error: unknown) => error);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    engineSide.close();

    expect(await pending).toMatchObject({ code: 'UNAVAILABLE' });
    await runtime.dispose();
  });

  it('молчащий движок: запрос отклоняется по сроку, хост это не перезапускает', async () => {
    const { engineSide, runtime, storage } = await bare();
    engineSide.onMessage(() => {});
    vi.useFakeTimers();
    let settled = false;

    const pending = storage.get('k').catch((error: unknown) => {
      settled = true;
      return error;
    });
    await vi.advanceTimersByTimeAsync(ENGINE_REQUEST_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);

    expect(await pending).toMatchObject({ code: 'TIMEOUT' });
    await runtime.dispose();
  });
});
