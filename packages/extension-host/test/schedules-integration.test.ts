import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHarness } from './state-harness.ts';
import type { Harness } from './state-harness.ts';
import { candidateOf } from './helpers.ts';

const ID = 'acme.sched';
const local = (h: number, mi = 0, s = 0): number =>
  new Date(2026, 9, 5, h, mi, s, 0).getTime();

const TICK_MS = 20;

let harness: Harness | null = null;
let previousZone: string | undefined;
beforeEach(() => {
  previousZone = process.env.TZ;
  process.env.TZ = 'UTC';
  vi.useFakeTimers();
});
afterEach(async () => {
  vi.useRealTimers();
  await harness?.close();
  harness = null;
  if (previousZone === undefined) delete process.env.TZ;
  else process.env.TZ = previousZone;
});

/** Часы, которыми управляет тест; планировщик проверяет их каждые `TICK_MS` на поддельных таймерах. */
const clock = (start: number) => {
  const state = { now: start };
  return {
    /** Переводит часы и даёт планировщику один период проверки. */
    async set(now: number): Promise<void> {
      state.now = now;
      await vi.advanceTimersByTimeAsync(TICK_MS);
    },
    schedule: { now: () => state.now, tickMs: TICK_MS },
  };
};

const settings = (patch: { disabled: string[] }) => ({
  checkUpdates: true,
  safeMode: false,
  notificationsOff: [],
  catalogUrl: null,
  schedulesOff: [],
  ...patch,
});

describe('расписания: планировщик → канал → рантайм', () => {
  it('расписание, зарегистрированное в server, попадает в снимок расширения', async () => {
    harness = await createHarness({
      candidates: [candidateOf(ID)],
      modules: {
        [ID]: {
          server: (s) => {
            s.schedule({ id: `${ID}.tick`, every: 'hourly' }, () => {});
            s.schedule(
              { id: `${ID}.daily`, every: 'daily', at: '09:00' },
              () => {},
            );
          },
        },
      },
    });

    expect(harness.discovery.get().extensions[0]?.schedules).toEqual([
      { id: `${ID}.tick`, every: 'hourly', at: null },
      { id: `${ID}.daily`, every: 'daily', at: '09:00' },
    ]);
  });

  it('срабатывание зовёт обработчик один раз; повторных вызовов в тот же момент нет', async () => {
    const fired: string[] = [];
    const time = clock(local(9, 59, 58));
    harness = await createHarness({
      candidates: [candidateOf(ID)],
      schedule: time.schedule,
      modules: {
        [ID]: {
          server: (s) => {
            s.schedule({ id: `${ID}.tick`, every: 'hourly' }, () => {
              fired.push('tick');
            });
          },
        },
      },
    });
    await time.set(local(9, 59, 59));
    expect(fired).toEqual([]);

    await time.set(local(10, 0, 1));
    await vi.waitFor(() => expect(fired).toEqual(['tick']));
    await time.set(local(10, 0, 30));
    expect(fired).toEqual(['tick']);

    await time.set(local(11, 0, 1));
    await vi.waitFor(() => expect(fired).toEqual(['tick', 'tick']));
  });

  it('отключённое расширение не срабатывает, включённое снова — на следующем моменте', async () => {
    let calls = 0;
    const time = clock(local(9, 59, 58));
    harness = await createHarness({
      candidates: [candidateOf(ID)],
      schedule: time.schedule,
      modules: {
        [ID]: {
          server: (s) => {
            s.schedule({ id: `${ID}.tick`, every: 'hourly' }, () => {
              calls += 1;
            });
          },
        },
      },
    });
    harness.policy.update(settings({ disabled: [ID] }));
    await time.set(local(10, 0, 1));
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(calls).toBe(0);

    harness.policy.update(settings({ disabled: [] }));
    await time.set(local(10, 0, 30));
    expect(calls).toBe(0);
    await time.set(local(11, 0, 1));
    await vi.waitFor(() => expect(calls).toBe(1));
  });

  it('сбой обработчика попадает в здоровье расширения, хост не перезапускается', async () => {
    const time = clock(local(9, 59, 58));
    const restart = vi.fn();
    harness = await createHarness({
      candidates: [candidateOf(ID)],
      schedule: time.schedule,
      restart,
      modules: {
        [ID]: {
          server: (s) => {
            s.schedule({ id: `${ID}.tick`, every: 'hourly' }, () => {
              throw new Error('boom');
            });
          },
        },
      },
    });
    await time.set(local(10, 0, 1));
    await vi.waitFor(() =>
      expect(harness?.engine.health.get(ID)).toMatchObject({ failures: 1 }),
    );
    expect(harness.engine.health.get(ID).lastFailure?.reason).toBe(
      'handler-failed',
    );
    expect(restart).not.toHaveBeenCalled();
  });
});
