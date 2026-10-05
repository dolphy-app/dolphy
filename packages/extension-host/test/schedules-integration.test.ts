import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverExtensions } from '../src/discover.ts';
import type { ResolvedExtension } from '../src/discover.ts';
import {
  createRestrictedRunner,
  defaultSpawn,
} from '../src/restricted-runner.ts';
import type { SpawnRestricted } from '../src/restricted-runner.ts';
import { createLogger } from './helpers.ts';
import { createHarness, stateful } from './state-harness.ts';
import type { Harness } from './state-harness.ts';

const fixtures = fileURLToPath(
  new URL('./fixtures/schedule-extensions', import.meta.url),
);
const entryPath = fileURLToPath(
  new URL('./fixtures/restricted-main.mjs', import.meta.url),
);
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

// Тест запускает дочерний процесс из исходников (см. restricted.test.ts)
const extraArgs = [
  `--allow-fs-read=${realpathSync(repoRoot)}`,
  '--disable-warning=ExperimentalWarning',
  ...((process.features as { typescript?: unknown }).typescript === false
    ? ['--experimental-strip-types']
    : []),
];
const spawnFromSources: SpawnRestricted = (spec) =>
  defaultSpawn({
    ...spec,
    args: [...spec.args.slice(0, -1), ...extraArgs, spec.args.at(-1) as string],
  });

const ID = 'acme.sched';
const TEST_TIMEOUT = 30_000;
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

describe('расписания в процессе хоста: планировщик → канал → рантайм', () => {
  it('срабатывание активирует расширение лениво, зовёт обработчик один раз; повторов нет', async () => {
    const fired: string[] = [];
    const time = clock(local(9, 59, 58));
    harness = createHarness({
      extensions: [
        stateful(ID, {
          schedules: [{ id: `${ID}.tick`, every: 'hourly', at: null }],
        }),
      ],
      trusted: [ID],
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
      trusted: [ID],
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
      trusted: [ID],
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
      trusted: [ID],
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
      trusted: [ID],
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

describe('расписания изолированного расширения в настоящем ограниченном процессе', () => {
  const start = async (commandDeadlineMs?: number) => {
    const found = await discoverExtensions({
      roots: [{ dir: fixtures, origin: 'user' }],
      logger: createLogger(),
    });
    const extension = found.extensions.find(
      (item) => item.id === ID,
    ) as ResolvedExtension;
    const time = clock(local(9, 59, 58));
    const restart = vi.fn();
    harness = createHarness({
      extensions: [extension],
      restart,
      schedule: time.schedule,
      runners: {
        create: (item, engine) =>
          createRestrictedRunner({
            extension: item,
            entryPath,
            library: { readText: async () => '', stat: async () => null },
            engine,
            logger: createLogger(),
            spawn: spawnFromSources,
            ...(commandDeadlineMs !== undefined && { commandDeadlineMs }),
          }),
      },
    });
    return { h: harness, time, restart };
  };

  it(
    'обработчик исполняется в дочернем процессе; сбой другого обработчика учитывается и не мешает',
    async () => {
      const { h, time } = await start();
      time.state.now = local(10, 0, 1);
      await vi.waitFor(
        async () => expect(await h.engine.read(ID, 'pid')).toBeTypeOf('number'),
        { timeout: 20_000 },
      );
      expect(await h.engine.read(ID, 'pid')).not.toBe(process.pid);
      await vi.waitFor(() =>
        expect(h.engine.health.get(ID).lastFailure).toMatchObject({
          reason: 'handler-failed',
          message: 'child boom',
        }),
      );
    },
    TEST_TIMEOUT,
  );

  it(
    'бесконечный цикл: раннер убивает процесс по сроку, срабатывание учтено как сбой, хост не перезапускается, следующее срабатывание идёт в новом процессе',
    async () => {
      const { h, time, restart } = await start(2_500);
      time.state.now = local(10, 0, 1);
      await vi.waitFor(
        async () => expect(await h.engine.read(ID, 'pid')).toBeTypeOf('number'),
        { timeout: 20_000 },
      );
      const before = await h.engine.read(ID, 'pid');
      time.state.now = local(10, 59, 59);
      await pause(80);
      time.state.now = local(11, 0, 1); // тут же срабатывают pid (час) и spin (11:00)
      await vi.waitFor(
        () =>
          expect(h.engine.health.get(ID).lastFailure?.reason).toBe(
            'handler-timeout',
          ),
        { timeout: 20_000 },
      );
      // каждый час срабатывает pid; пока старый вызов не вернулся, новый пропускается, поэтому часы идут, пока pid не сменится
      let hour = 12;
      await vi.waitFor(
        async () => {
          time.state.now = local(hour, 0, 1);
          hour += 1;
          expect(await h.engine.read(ID, 'pid')).not.toBe(before);
        },
        { timeout: 20_000, interval: 150 },
      );
      expect(restart).not.toHaveBeenCalled();
    },
    TEST_TIMEOUT,
  );
});
