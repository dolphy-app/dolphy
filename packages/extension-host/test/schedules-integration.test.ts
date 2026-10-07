import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHarness, stateful } from './state-harness.ts';
import type { Harness } from './state-harness.ts';

const ID = 'acme.sched';
const local = (h: number, mi = 0, s = 0): number =>
  new Date(2026, 9, 5, h, mi, s, 0).getTime();

const pause = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

let harness: Harness | null = null;
let previousZone: string | undefined;
beforeEach(() => {
  previousZone = process.env.TZ;
  process.env.TZ = 'UTC';
});
afterEach(async () => {
  await harness?.close();
  harness = null;
  if (previousZone === undefined) delete process.env.TZ;
  else process.env.TZ = previousZone;
});

/** Часы, которыми управляет тест; планировщик проверяет их каждые 20 мс настоящего времени. */
const clock = (start: number) => {
  const state = { now: start };
  return {
    state,
    schedule: { now: () => state.now, tickMs: 20 },
  };
};

describe('расписания: планировщик → канал → рантайм', () => {
  it('срабатывание активирует расширение лениво, зовёт обработчик один раз; повторов нет', async () => {
    const fired: string[] = [];
    const time = clock(local(9, 59, 58));
    harness = createHarness({
      extensions: [
        stateful(ID, {
          schedules: [{ id: `${ID}.tick`, every: 'hourly', at: null }],
        }),
      ],
      schedule: time.schedule,
      modules: {
        [ID]: {
          activate: (ctx) => {
            fired.push('activate');
            ctx.schedule.on(`${ID}.tick`, () => {
              fired.push('tick');
            });
          },
        },
      },
    });
    await pause(80);
    expect(fired).toEqual([]); // до срабатывания расширение не активируется

    time.state.now = local(10, 0, 1);
    await vi.waitFor(() => expect(fired).toEqual(['activate', 'tick']));
    time.state.now = local(10, 0, 30);
    await pause(100);
    expect(fired).toEqual(['activate', 'tick']);
  });

  it('отключённое расширение не срабатывает, включённое снова — на следующем моменте', async () => {
    let calls = 0;
    const time = clock(local(9, 59, 58));
    harness = createHarness({
      extensions: [
        stateful(ID, {
          schedules: [{ id: `${ID}.tick`, every: 'hourly', at: null }],
        }),
      ],
      schedule: time.schedule,
      modules: {
        [ID]: {
          activate: (ctx) => {
            ctx.schedule.on(`${ID}.tick`, () => {
              calls += 1;
            });
          },
        },
      },
    });
    harness.policy.update({
      disabled: [ID],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
      schedulesOff: [],
    });
    time.state.now = local(10, 0, 1);
    await pause(120);
    expect(calls).toBe(0);

    harness.policy.update({
      disabled: [],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
      schedulesOff: [],
    });
    time.state.now = local(11, 0, 1);
    await vi.waitFor(() => expect(calls).toBe(1));
  });

  it('сбой обработчика попадает в здоровье расширения, хост не перезапускается', async () => {
    const time = clock(local(9, 59, 58));
    const restart = vi.fn();
    harness = createHarness({
      extensions: [
        stateful(ID, {
          schedules: [{ id: `${ID}.tick`, every: 'hourly', at: null }],
        }),
      ],
      schedule: time.schedule,
      restart,
      modules: {
        [ID]: {
          activate: (ctx) => {
            ctx.schedule.on(`${ID}.tick`, () => {
              throw new Error('boom');
            });
          },
        },
      },
    });
    time.state.now = local(10, 0, 1);
    await vi.waitFor(() =>
      expect(harness?.engine.health.get(ID)).toMatchObject({ failures: 1 }),
    );
    expect(harness.engine.health.get(ID).lastFailure?.reason).toBe(
      'handler-failed',
    );
    expect(restart).not.toHaveBeenCalled();
  });
});
