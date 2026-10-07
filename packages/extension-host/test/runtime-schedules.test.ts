import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExtRequest, ExtResponse } from '../src/protocol.ts';
import { SCHEDULE_HANDLER_MS, createExtensionRuntime } from '../src/runtime.ts';
import type { ExtensionRuntime, ServerModule } from '../src/runtime.ts';
import { candidateOf, createLogger, nullLibrary } from './helpers.ts';

const ID = 'acme.sched';
const MORNING = `${ID}.morning`;
const TICK = `${ID}.tick`;

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

/** Хост с расширением, чей `server` — переданная функция; расписания регистрирует она сама. */
const open = async (
  server: NonNullable<ServerModule['server']>,
  logger = createLogger(),
): Promise<ExtensionRuntime> => {
  runtime = createExtensionRuntime({
    library: nullLibrary,
    logger,
    modules: { [ID]: { server } },
  });
  await runtime.replace([candidateOf(ID)]);
  return runtime;
};

const failureOf = (response: ExtResponse) =>
  response.ok ? null : response.error;

describe('fireSchedule в процессе хоста', () => {
  it('зовёт зарегистрированный обработчик без аргументов; server вызывается один раз', async () => {
    const handler = vi.fn();
    const server = vi.fn(
      (s: Parameters<NonNullable<ServerModule['server']>>[0]) => {
        s.schedule({ id: MORNING, every: 'daily', at: '09:00' }, handler);
      },
    );
    const host = await open(server);

    const response = await host.handle(fire(MORNING));

    expect(response).toEqual({
      id: '1',
      ok: true,
      result: { delivered: true },
    });
    expect(handler).toHaveBeenCalledWith();
    await host.handle(fire(MORNING, '2'));
    expect(server).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('незарегистрированное расписание — delivered: false, а не отказ', async () => {
    const host = await open((s) => {
      s.schedule({ id: TICK, every: 'hourly' }, () => undefined);
    });

    expect(await host.handle(fire('acme.sched.ghost'))).toEqual({
      id: '1',
      ok: true,
      result: { delivered: false },
    });
  });

  it('сбой обработчика — handler-failed, расширение остаётся работоспособным', async () => {
    const host = await open((s) => {
      s.schedule({ id: MORNING, every: 'daily', at: '09:00' }, () => {
        throw new Error('boom');
      });
      s.schedule({ id: TICK, every: 'hourly' }, () => undefined);
    });

    expect(failureOf(await host.handle(fire(MORNING)))).toEqual({
      cause: 'handler-failed',
      message: 'boom',
    });
    expect(await host.handle(fire(TICK, '2'))).toMatchObject({ ok: true });
  });

  it('обработчик ограничен 10 с: handler-timeout, а не раньше', async () => {
    expect(SCHEDULE_HANDLER_MS).toBe(10_000);
    const host = await open((s) => {
      s.schedule(
        { id: MORNING, every: 'daily', at: '09:00' },
        () => new Promise<void>(() => {}),
      );
    });
    vi.useFakeTimers();
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
    let finish: () => void = () => {};
    const handler = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const logger = createLogger();
    const host = await open((s) => {
      s.schedule({ id: MORNING, every: 'daily', at: '09:00' }, handler);
    }, logger);
    vi.useFakeTimers();
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
    const host = await open(() => undefined);
    const response = await host.handle({
      id: '9',
      method: 'fireSchedule',
      params: { extensionId: 'acme.none', scheduleId: 'x' },
    });
    expect(failureOf(response)).toMatchObject({ cause: 'unknown-type' });
  });
});

describe('s.schedule', () => {
  it('чужой id и повторная регистрация бросают из вызова; освобождённая регистрация снимается', async () => {
    const errors: string[] = [];
    const handler = vi.fn();
    const host = await open((s) => {
      const attempt = (call: () => void) => {
        try {
          call();
        } catch (error) {
          errors.push((error as Error).message);
        }
      };
      attempt(() =>
        s.schedule({ id: 'other.ghost', every: 'hourly' }, handler),
      );
      const registration = s.schedule(
        { id: MORNING, every: 'daily', at: '09:00' },
        handler,
      );
      attempt(() =>
        s.schedule({ id: MORNING, every: 'daily', at: '10:00' }, handler),
      );
      void registration.dispose();
    });

    expect(await host.handle(fire(MORNING))).toMatchObject({
      ok: true,
      result: { delivered: false },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("schedule 'other.ghost'");
    expect(errors[1]).toContain(`schedule '${MORNING}'`);
    expect(errors[1]).toContain('duplicate');
  });

  it('расписание с неверным временем отвергается при регистрации', async () => {
    const errors: string[] = [];
    await open((s) => {
      try {
        s.schedule(
          { id: MORNING, every: 'daily', at: '25:99' },
          () => undefined,
        );
      } catch (error) {
        errors.push((error as Error).message);
      }
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`schedule '${MORNING}'`);
  });
});
