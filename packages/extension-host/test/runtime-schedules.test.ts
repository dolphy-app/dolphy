import type { ExtensionModule } from '@dolphy-app/extension-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedExtension } from '../src/discover.ts';
import type { ExtRequest, ExtResponse } from '../src/protocol.ts';
import { SCHEDULE_HANDLER_MS, createExtensionRuntime } from '../src/runtime.ts';
import type { ExtensionRuntime } from '../src/runtime.ts';
import { createLogger, nullLibrary } from './helpers.ts';
import { stateful } from './state-harness.ts';

const ID = 'acme.sched';
const MORNING = `${ID}.morning`;
const TICK = `${ID}.tick`;

const extension = (): ResolvedExtension =>
  stateful(ID, {
    schedules: [
      { id: MORNING, every: 'daily', at: '09:00' },
      { id: TICK, every: 'hourly', at: null },
    ],
  });

const fire = (scheduleId: string, id = '1'): ExtRequest => ({
  id,
  method: 'fireSchedule',
  params: { extensionId: ID, scheduleId },
});

let runtime: ExtensionRuntime | null = null;
afterEach(async () => {
  vi.useRealTimers();
  await runtime?.dispose();
  runtime = null;
});

const open = (
  module: ExtensionModule,
  logger = createLogger(),
): ExtensionRuntime => {
  runtime = createExtensionRuntime({
    extensions: [extension()],
    library: nullLibrary,
    logger,
    modules: { [ID]: module },
  });
  return runtime;
};

const failureOf = (response: ExtResponse) =>
  response.ok ? null : response.error;

describe('fireSchedule в процессе хоста', () => {
  it('активирует расширение лениво и зовёт подписанный обработчик без аргументов', async () => {
    const handler = vi.fn();
    const activate = vi.fn(
      (ctx: Parameters<ExtensionModule['activate']>[0]) => {
        ctx.schedule.on(MORNING, handler);
      },
    );
    const host = open({ activate });
    expect(activate).not.toHaveBeenCalled();

    const response = await host.handle(fire(MORNING));

    expect(response).toEqual({
      id: '1',
      ok: true,
      result: { delivered: true },
    });
    expect(activate).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith();
    await host.handle(fire(MORNING, '2'));
    expect(activate).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('не объявленное в манифесте расписание расширение не активирует; объявленное, но не подписанное — delivered: false', async () => {
    const activate = vi.fn();
    const host = open({ activate });

    expect((await host.handle(fire('acme.sched.ghost'))).ok).toBe(true);
    expect(activate).not.toHaveBeenCalled();
    expect(await host.handle(fire(TICK, '2'))).toMatchObject({
      ok: true,
      result: { delivered: false },
    });
  });

  it('сбой обработчика — handler-failed, расширение остаётся работоспособным', async () => {
    const host = open({
      activate: (ctx) => {
        ctx.schedule.on(MORNING, () => {
          throw new Error('boom');
        });
        ctx.schedule.on(TICK, () => undefined);
      },
    });

    expect(failureOf(await host.handle(fire(MORNING)))).toEqual({
      cause: 'handler-failed',
      message: 'boom',
    });
    expect(await host.handle(fire(TICK, '2'))).toMatchObject({ ok: true });
  });

  it('обработчик ограничен 10 с: handler-timeout, а не раньше', async () => {
    vi.useFakeTimers();
    expect(SCHEDULE_HANDLER_MS).toBe(10_000);
    const host = open({
      activate: (ctx) => {
        ctx.schedule.on(MORNING, () => new Promise<void>(() => {}));
      },
    });
    let settled = false;
    const pending = host.handle(fire(MORNING)).then((response) => {
      settled = true;
      return response;
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(failureOf(await pending)).toMatchObject({
      cause: 'handler-timeout',
    });
  });

  it('обработчик, не вернувшийся к сроку, ещё работает: следующее срабатывание пропускается, после его завершения идёт снова', async () => {
    vi.useFakeTimers();
    let finish: () => void = () => {};
    const handler = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const logger = createLogger();
    const host = open(
      {
        activate: (ctx) => {
          ctx.schedule.on(MORNING, handler);
        },
      },
      logger,
    );
    const first = host.handle(fire(MORNING));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(failureOf(await first)).toMatchObject({ cause: 'handler-timeout' });

    expect(await host.handle(fire(MORNING, '2'))).toMatchObject({
      ok: true,
      result: { delivered: false },
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { extensionId: ID, scheduleId: MORNING },
      'schedule handler is still running, the firing is skipped',
    );

    finish();
    await vi.advanceTimersByTimeAsync(0);
    const third = host.handle(fire(MORNING, '3'));
    await vi.advanceTimersByTimeAsync(0);
    expect(handler).toHaveBeenCalledTimes(2);
    finish();
    expect(await third).toMatchObject({ ok: true });
  });

  it('неизвестное расширение — отказ, а не тихий пропуск', async () => {
    const host = open({ activate: () => undefined });
    const response = await host.handle({
      id: '9',
      method: 'fireSchedule',
      params: { extensionId: 'acme.none', scheduleId: 'x' },
    });
    expect(failureOf(response)).toMatchObject({ cause: 'unknown-type' });
  });
});

describe('ctx.schedule', () => {
  const errors: unknown[] = [];
  const capture = (call: () => void) => {
    try {
      call();
    } catch (error) {
      errors.push(error);
    }
  };

  it('подписка на необъявленное расписание и вторая подписка бросают; освобождённая подписка снимается', async () => {
    errors.length = 0;
    const handler = vi.fn();
    const host = open({
      activate: (ctx) => {
        capture(() => ctx.schedule.on('acme.sched.ghost', handler));
        const subscription = ctx.schedule.on(MORNING, handler);
        capture(() => ctx.schedule.on(MORNING, handler));
        void subscription.dispose();
      },
    });

    expect(await host.handle(fire(MORNING))).toMatchObject({
      ok: true,
      result: { delivered: false },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(errors.map((error) => (error as Error).message)).toEqual([
      "schedule 'acme.sched.ghost' is not declared in the manifest of 'acme.sched'",
      "schedule 'acme.sched.morning' is already subscribed",
    ]);
  });

  it('объявленное, но не подписанное в activate расписание попадает в журнал предупреждением', async () => {
    const logger = createLogger();
    const host = open(
      {
        activate: (ctx) => {
          ctx.schedule.on(MORNING, () => undefined);
        },
      },
      logger,
    );
    await host.handle(fire(MORNING));
    expect(logger.warn).toHaveBeenCalledWith(
      { extensionId: ID, kind: 'schedules', ids: [TICK] },
      'declared in the manifest but not registered by the extension code',
    );
  });
});
