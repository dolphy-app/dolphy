import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { ChannelOutcome, HostChannel } from '../src/channel.ts';
import type { ExtensionOrigin, ResolvedExtension } from '../src/discover.ts';
import { createExtensionPolicy } from '../src/policy.ts';
import type { ResolvedSchedule } from '../src/points/types.ts';
import { createScheduler, latestOccurrence } from '../src/scheduler.ts';
import { createLogger, holderOf } from './helpers.ts';

const LATE = 120_000;
const local = (
  y: number,
  mo: number,
  d: number,
  h = 0,
  mi = 0,
  s = 0,
): number => new Date(y, mo - 1, d, h, mi, s, 0).getTime();

const daily = (at: string): ResolvedSchedule => ({
  id: 'a',
  every: 'daily',
  at,
});
const hourly: ResolvedSchedule = { id: 'h', every: 'hourly', at: null };

let zone: string | undefined;
const setZone = (value: string) => {
  process.env.TZ = value;
};
beforeAll(() => {
  zone = process.env.TZ;
});
afterAll(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

describe('latestOccurrence', () => {
  beforeEach(() => setZone('UTC'));

  it('daily: срабатывание между прошлой проверкой и сейчас, не раньше курсора', () => {
    const at = daily('09:00');
    const moment = local(2026, 10, 5, 9);
    expect(latestOccurrence(at, moment - 20_000, moment + 10_000, LATE)).toBe(
      moment,
    );
    // курсор уже на самом моменте: он обработан прошлой проверкой
    expect(latestOccurrence(at, moment, moment + 10_000, LATE)).toBeNull();
    // момент ещё впереди
    expect(
      latestOccurrence(at, moment - 40_000, moment - 10_000, LATE),
    ).toBeNull();
  });

  it('опоздание: ровно 2 минуты ещё срабатывает, на миллисекунду позже — пропуск', () => {
    const at = daily('09:00');
    const moment = local(2026, 10, 5, 9);
    const cursor = moment - 60_000;
    expect(latestOccurrence(at, cursor, moment + LATE, LATE)).toBe(moment);
    expect(latestOccurrence(at, cursor, moment + LATE + 1, LATE)).toBeNull();
  });

  it('сон: после долгого перерыва прошлые срабатывания не воспроизводятся', () => {
    const at = daily('09:00');
    expect(
      latestOccurrence(at, local(2026, 10, 5, 8), local(2026, 10, 5, 12), LATE),
    ).toBeNull();
    expect(
      latestOccurrence(
        hourly,
        local(2026, 10, 5, 8),
        local(2026, 10, 5, 12, 30),
        LATE,
      ),
    ).toBeNull();
  });

  it('daily пересекает полночь: 00:00 срабатывает с проверки до полуночи', () => {
    const moment = local(2026, 10, 6, 0);
    expect(
      latestOccurrence(daily('00:00'), moment - 20_000, moment + 10_000, LATE),
    ).toBe(moment);
    expect(
      latestOccurrence(daily('23:59'), moment - 80_000, moment + 10_000, LATE),
    ).toBe(local(2026, 10, 5, 23, 59));
  });

  it('hourly: начало часа; середина часа ничего не даёт', () => {
    const top = local(2026, 10, 5, 14);
    expect(latestOccurrence(hourly, top - 20_000, top + 5_000, LATE)).toBe(top);
    expect(
      latestOccurrence(hourly, top + 600_000, top + 630_000, LATE),
    ).toBeNull();
  });

  it('часовой пояс со смещением 30 минут: час начинается по местному времени', () => {
    setZone('Asia/Kolkata');
    const top = local(2026, 10, 5, 14);
    expect(new Date(top).getUTCMinutes()).toBe(30);
    expect(latestOccurrence(hourly, top - 20_000, top + 5_000, LATE)).toBe(top);
    expect(
      latestOccurrence(hourly, top - 1_820_000, top - 1_790_000, LATE),
    ).toBeNull();
  });

  describe('переход на летнее время (Europe/Berlin)', () => {
    beforeEach(() => setZone('Europe/Berlin'));

    it('отсутствующее местное время (02:30 в сутки перехода) не срабатывает, 03:00 срабатывает', () => {
      const jump = Date.UTC(2026, 2, 29, 1, 0, 0); // 02:00 CET = 03:00 CEST
      expect(
        latestOccurrence(daily('02:30'), jump - 20_000, jump + 20_000, LATE),
      ).toBeNull();
      expect(
        latestOccurrence(daily('02:30'), jump - 20_000, jump + 3_000_000, LATE),
      ).toBeNull();
      expect(
        latestOccurrence(daily('03:00'), jump - 20_000, jump + 20_000, LATE),
      ).toBe(jump);
    });

    it('осенью повторяющееся 02:30 срабатывает один раз — в первое вхождение', () => {
      const first = Date.UTC(2026, 9, 25, 0, 30, 0); // 02:30 CEST
      const second = Date.UTC(2026, 9, 25, 1, 30, 0); // 02:30 CET
      expect(
        latestOccurrence(daily('02:30'), first - 20_000, first + 10_000, LATE),
      ).toBe(first);
      expect(
        latestOccurrence(
          daily('02:30'),
          second - 20_000,
          second + 10_000,
          LATE,
        ),
      ).toBeNull();
    });

    it('hourly срабатывает в каждый реальный час, в том числе в повторяющийся', () => {
      const firstTwo = Date.UTC(2026, 9, 25, 0, 0, 0); // 02:00 CEST
      const secondTwo = Date.UTC(2026, 9, 25, 1, 0, 0); // 02:00 CET
      expect(
        latestOccurrence(hourly, firstTwo - 5_000, firstTwo + 5_000, LATE),
      ).toBe(firstTwo);
      expect(
        latestOccurrence(hourly, secondTwo - 5_000, secondTwo + 5_000, LATE),
      ).toBe(secondTwo);
    });
  });
});

const extension = (
  id: string,
  schedules: ResolvedSchedule[],
  origin: ExtensionOrigin = 'user',
): ResolvedExtension => ({
  id,
  version: '1.0.0',
  origin,
  revision: '',
  dir: `/x/${id}`,
  mainPath: '/x/main.mjs',
  name: null,
  description: null,
  author: null,
  dependencies: [],
  platforms: [],
  minAppVersion: null,
  icon: null,
  tags: [],
  install: null,
  messages: {},
  warnings: [],
  exerciseTypes: [],
  themes: [],
  markdownRenderers: [],
  gradePolicies: [],
  settings: [],
  events: [],
  commands: [],
  widgets: [],
  schedules,
  panels: [],
  importers: [],
  exporters: [],
});

const settings = (patch: Record<string, unknown> = {}) => ({
  disabled: [],
  checkUpdates: true,
  safeMode: false,
  notificationsOff: [],
  catalogUrl: null,
  schedulesOff: [],
  ...patch,
});

interface Call {
  method: string;
  params: { extensionId: string; scheduleId: string };
}

const harness = (extensions: ResolvedExtension[], start: number) => {
  const calls: Call[] = [];
  const pending: ((outcome: ChannelOutcome) => void)[] = [];
  let connected = true;
  let respond: (() => Promise<ChannelOutcome>) | null = null;
  const channel = {
    connected: () => connected,
    call: (method: string, params: Call['params']) => {
      calls.push({ method, params });
      if (respond !== null) return respond();
      return Promise.resolve<ChannelOutcome>({
        kind: 'response',
        response: { id: '1', ok: true, result: { delivered: true } },
      });
    },
  } as unknown as HostChannel;
  const holder = holderOf(extensions);
  const policy = createExtensionPolicy(holder);
  const logger = createLogger();
  const health = { recordFailure: vi.fn() };
  let now = start;
  const scheduler = createScheduler({
    channel,
    discovery: holder,
    policy,
    logger,
    health,
    now: () => now,
    tickMs: 1_000_000,
  });
  return {
    calls,
    pending,
    scheduler,
    policy,
    holder,
    logger,
    health,
    setConnected: (value: boolean) => {
      connected = value;
    },
    answer: (next: (() => Promise<ChannelOutcome>) | null) => {
      respond = next;
    },
    at: async (time: number) => {
      now = time;
      await scheduler.tick();
    },
  };
};

describe('createScheduler', () => {
  beforeEach(() => setZone('UTC'));

  it('активирует лениво: отправляет fireSchedule в момент срабатывания и только один раз', async () => {
    const t = harness(
      [extension('acme.a', [daily('09:00')])],
      local(2026, 10, 5, 8, 59),
    );
    await t.at(local(2026, 10, 5, 8, 59, 30));
    expect(t.calls).toEqual([]);
    await t.at(local(2026, 10, 5, 9, 0, 10));
    expect(t.calls).toEqual([
      {
        method: 'fireSchedule',
        params: { extensionId: 'acme.a', scheduleId: 'a' },
      },
    ]);
    await t.at(local(2026, 10, 5, 9, 0, 40));
    await t.at(local(2026, 10, 5, 9, 1, 10));
    expect(t.calls).toHaveLength(1);
    await t.at(local(2026, 10, 6, 9, 0, 5));
    expect(t.calls).toHaveLength(2);
  });

  it('приложение спало: пропущенное не воспроизводится, следующее срабатывание идёт штатно', async () => {
    const t = harness(
      [extension('acme.a', [daily('09:00')])],
      local(2026, 10, 5, 8),
    );
    await t.at(local(2026, 10, 5, 12));
    expect(t.calls).toEqual([]);
    await t.at(local(2026, 10, 6, 8, 59, 40));
    await t.at(local(2026, 10, 6, 9, 0, 10));
    expect(t.calls).toHaveLength(1);
  });

  it('проснулись через минуту после срока — срабатывает; через три — нет', async () => {
    const early = harness(
      [extension('acme.a', [daily('09:00')])],
      local(2026, 10, 5, 8),
    );
    await early.at(local(2026, 10, 5, 9, 1));
    expect(early.calls).toHaveLength(1);
    const late = harness(
      [extension('acme.a', [daily('09:00')])],
      local(2026, 10, 5, 8),
    );
    await late.at(local(2026, 10, 5, 9, 3));
    expect(late.calls).toEqual([]);
  });

  it('обработчик, ещё работающий с прошлого срабатывания, нового не получает', async () => {
    const t = harness(
      [extension('acme.a', [hourly])],
      local(2026, 10, 5, 9, 59),
    );
    let release: (outcome: ChannelOutcome) => void = () => {};
    t.answer(
      () =>
        new Promise<ChannelOutcome>((resolve) => {
          release = resolve;
        }),
    );
    const first = t.at(local(2026, 10, 5, 10, 0, 5));
    await t.at(local(2026, 10, 5, 11, 0, 5));
    expect(t.calls).toHaveLength(1);
    expect(t.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ extensionId: 'acme.a', scheduleId: 'h' }),
      'schedule handler is still running, the firing is skipped',
    );
    release({
      kind: 'response',
      response: { id: '1', ok: true, result: { delivered: true } },
    });
    await first;
    t.answer(null);
    await t.at(local(2026, 10, 5, 12, 0, 5));
    expect(t.calls).toHaveLength(2);
  });

  it('отключённое расширение, выключенный переключатель и безопасный режим не срабатывают сразу', async () => {
    const t = harness(
      [extension('acme.a', [hourly]), extension('acme.b', [hourly])],
      local(2026, 10, 5, 9, 59),
    );
    t.policy.update(
      settings({ disabled: ['acme.a'], schedulesOff: ['acme.b'] }),
    );
    await t.at(local(2026, 10, 5, 10, 0, 5));
    expect(t.calls).toEqual([]);

    t.policy.update(settings());
    await t.at(local(2026, 10, 5, 11, 0, 5));
    expect(t.calls.map(({ params }) => params.extensionId)).toEqual([
      'acme.a',
      'acme.b',
    ]);

    t.policy.update(settings({ safeMode: true }));
    await t.at(local(2026, 10, 5, 12, 0, 5));
    expect(t.calls).toHaveLength(2);
  });

  it('включённый обратно переключатель не воспроизводит пропущенное', async () => {
    const t = harness(
      [extension('acme.a', [hourly])],
      local(2026, 10, 5, 9, 59),
    );
    t.policy.update(settings({ schedulesOff: ['acme.a'] }));
    await t.at(local(2026, 10, 5, 10, 0, 5));
    t.policy.update(settings());
    await t.at(local(2026, 10, 5, 10, 0, 35));
    expect(t.calls).toEqual([]);
  });

  it('удалённое расширение не срабатывает: набор читается на каждом тике', async () => {
    const a = extension('acme.a', [hourly]);
    const t = harness([a], local(2026, 10, 5, 9, 59));
    t.holder.replace({
      extensions: [],
      diagnostics: [],
      overridden: [],
    } as never);
    await t.at(local(2026, 10, 5, 10, 0, 5));
    expect(t.calls).toEqual([]);
  });

  it('хост отключён: срабатывание теряется и после подключения не воспроизводится', async () => {
    const t = harness(
      [extension('acme.a', [hourly])],
      local(2026, 10, 5, 9, 59),
    );
    t.setConnected(false);
    await t.at(local(2026, 10, 5, 10, 0, 5));
    t.setConnected(true);
    await t.at(local(2026, 10, 5, 10, 0, 35));
    expect(t.calls).toEqual([]);
  });

  it('сбой обработчика и просроченная доставка попадают в здоровье расширения и в журнал', async () => {
    const t = harness(
      [extension('acme.a', [hourly])],
      local(2026, 10, 5, 9, 59),
    );
    t.answer(async () => ({
      kind: 'response',
      response: {
        id: '1',
        ok: false,
        error: { cause: 'handler-failed', message: 'boom' },
      },
    }));
    await t.at(local(2026, 10, 5, 10, 0, 5));
    expect(t.health.recordFailure).toHaveBeenCalledWith(
      'acme.a',
      'handler-failed',
      'boom',
    );
    t.answer(async () => ({ kind: 'timeout' }));
    await t.at(local(2026, 10, 5, 11, 0, 5));
    expect(t.health.recordFailure).toHaveBeenLastCalledWith(
      'acme.a',
      'timeout',
      'extension schedule delivery timed out',
    );
    // не вина расширения (замена набора): здоровье не трогается
    t.answer(async () => ({
      kind: 'response',
      response: {
        id: '1',
        ok: false,
        error: { cause: 'replaced', message: 'replaced' },
      },
    }));
    await t.at(local(2026, 10, 5, 12, 0, 5));
    expect(t.health.recordFailure).toHaveBeenCalledTimes(2);
    expect(t.logger.warn).toHaveBeenCalledTimes(3);
  });

  it('расписания одного расширения доставляются независимо', async () => {
    const t = harness(
      [
        extension('acme.a', [
          { id: 'acme.a.one', every: 'hourly', at: null },
          { id: 'acme.a.two', every: 'daily', at: '10:00' },
        ]),
      ],
      local(2026, 10, 5, 9, 59),
    );
    await t.at(local(2026, 10, 5, 10, 0, 5));
    expect(t.calls.map(({ params }) => params.scheduleId)).toEqual([
      'acme.a.one',
      'acme.a.two',
    ]);
  });
});

describe('таймер планировщика', () => {
  beforeEach(() => {
    setZone('UTC');
    vi.useFakeTimers();
  });
  afterAll(() => vi.useRealTimers());

  it('проверяет по своим часам с заданным периодом; dispose останавливает таймер', async () => {
    let now = local(2026, 10, 5, 9, 59, 59);
    const calls: string[] = [];
    const holder = holderOf([extension('acme.a', [hourly])]);
    const scheduler = createScheduler({
      channel: {
        connected: () => true,
        call: async (method: string) => {
          calls.push(method);
          return {
            kind: 'response',
            response: { id: '1', ok: true, result: { delivered: true } },
          };
        },
      } as unknown as HostChannel,
      discovery: holder,
      policy: createExtensionPolicy(holder),
      logger: createLogger(),
      now: () => now,
      tickMs: 100,
    });
    now = local(2026, 10, 5, 10, 0, 1);
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toEqual(['fireSchedule']);
    scheduler.dispose();
    now = local(2026, 10, 5, 11, 0, 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(1);
  });
});
