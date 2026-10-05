/**
 * `ExtensionHostServices.stats` (спека extension-api-breadth-1, R7, R8):
 * разрешение решает движок, ответ — только числа, индекс сбрасывается записями журнала.
 */
import type { ExtensionInfoDto } from '@dolphy-app/engine-contract';
import {
  buildLibrary,
  createFakeExtensionPolicy,
  createFakeExtensionRegistry,
} from '@dolphy-app/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestEngine } from '../../helpers/engine.ts';
import type { TestEngine } from '../../helpers/engine.ts';

const base: Omit<ExtensionInfoDto, 'id' | 'permissions' | 'state'> = {
  version: '1.0.0',
  origin: 'user',
  contributes: {
    exerciseTypes: [],
    themes: [],
    markdownRenderers: [],
    gradePolicies: [],
    settings: [],
    events: [],
    commands: [],
    widgets: [],
    panels: [],
    importers: [],
    exporters: [],
  },
  diagnostics: [],
  isolation: 'isolated',
  toggleable: true,
  name: null,
  description: null,
  author: null,
  installed: null,
  icon: null,
  titles: {},
  messages: {},
  tags: [],
  removable: true,
  revoked: null,
  deprecated: null,
};
const ext = (
  id: string,
  permissions: string[],
  state: ExtensionInfoDto['state'] = 'loaded',
): ExtensionInfoDto => ({ ...base, id, permissions, state });

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 2024-05-10 12:00 UTC (пятница). */
const NOON = Date.UTC(2024, 4, 10, 12);

let zone: string | undefined;
beforeAll(() => {
  zone = process.env.TZ;
  process.env.TZ = 'UTC';
});
afterAll(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

const open = () =>
  createTestEngine({
    library: buildLibrary({
      courses: [
        { id: 'alpha', lessons: [{ id: 'l', exercises: 2 }] },
        { id: 'beta', lessons: [{ id: 'l', exercises: 1 }] },
      ],
    }),
    extensionRegistry: createFakeExtensionRegistry([
      ext('acme.stats', ['learning.stats']),
      ext('acme.plain', ['learning.events']),
      ext('acme.off', ['learning.stats'], 'disabled'),
    ]),
    extensionPolicy: createFakeExtensionPolicy({
      settings: {
        disabled: ['acme.off'],
        trusted: [],
        checkUpdates: true,
        safeMode: false,
      },
    }),
  });

let requests = 0;
/** Попытка `daysAgo` суток назад (в полдень UTC). */
const study = async (
  t: TestEngine,
  exerciseId: string,
  grade: 1 | 2 | 3 | 4 | 5,
  daysAgo: number,
) => {
  t.clock.set(NOON - daysAgo * DAY);
  requests += 1;
  await t.engine.practice.recordAttempt({
    requestId: `r${requests}`,
    exerciseId,
    grade,
  });
};

const seeded = async () => {
  const t = await open();
  await study(t, 'alpha::l::e0', 4, 3);
  await study(t, 'alpha::l::e1', 2, 3);
  await study(t, 'beta::l::e0', 5, 1);
  await study(t, 'alpha::l::e0', 3, 0);
  t.clock.set(NOON + HOUR);
  return t;
};

const rejection = async (call: Promise<unknown>) => {
  try {
    await call;
  } catch (error) {
    return error as Error & {
      code?: string;
      details?: Record<string, unknown>;
    };
  }
  throw new Error('expected a rejection');
};

describe('разрешение', () => {
  it('расширение без learning.stats получает INVALID_ARGUMENT с reason permission — решает движок, а не процесс', async () => {
    const { engine } = await seeded();
    const { stats } = engine.extensionHost;
    for (const call of [
      stats.streak('acme.plain'),
      stats.daily('acme.plain', '2024-05-01', '2024-05-10'),
    ]) {
      const error = await rejection(call);
      expect(error.code).toBe('INVALID_ARGUMENT');
      expect(error.details).toEqual({
        reason: 'permission',
        permission: 'learning.stats',
        extensionId: 'acme.plain',
      });
    }
  });

  it('отключённое расширение — disabled, неизвестное — NOT_FOUND, чужой id вместо расширения — INVALID_ARGUMENT', async () => {
    const { engine } = await seeded();
    const { stats } = engine.extensionHost;
    expect((await rejection(stats.streak('acme.off'))).details).toMatchObject({
      reason: 'disabled',
    });
    expect((await rejection(stats.streak('acme.nobody'))).code).toBe(
      'NOT_FOUND',
    );
    expect((await rejection(stats.streak('Not An Id'))).code).toBe(
      'INVALID_ARGUMENT',
    );
  });
});

describe('ответ', () => {
  it('серия и разбивка по дням считаются по журналу; 2 — не верно, 3 — верно', async () => {
    const { engine } = await seeded();
    const { stats } = engine.extensionHost;
    // 7 мая: 2 попытки (4 и 2), 9 мая: 1 (5), 10 мая: 1 (3); 8 мая пуст
    expect(await stats.streak('acme.stats')).toEqual({
      current: 2,
      longest: 2,
    });
    expect(await stats.daily('acme.stats', '2024-05-07', '2024-05-10')).toEqual(
      [
        { date: '2024-05-07', attempts: 2, correct: 1, accuracy: 0.5 },
        { date: '2024-05-08', attempts: 0, correct: 0, accuracy: null },
        { date: '2024-05-09', attempts: 1, correct: 1, accuracy: 1 },
        { date: '2024-05-10', attempts: 1, correct: 1, accuracy: 1 },
      ],
    );
  });

  it('фильтр курса; неизвестный курс — нули', async () => {
    const { engine } = await seeded();
    const { stats } = engine.extensionHost;
    expect(await stats.streak('acme.stats', 'beta')).toEqual({
      current: 1,
      longest: 1,
    });
    expect(
      await stats.daily('acme.stats', '2024-05-07', '2024-05-07', 'alpha'),
    ).toEqual([{ date: '2024-05-07', attempts: 2, correct: 1, accuracy: 0.5 }]);
    expect(await stats.streak('acme.stats', 'nope')).toEqual({
      current: 0,
      longest: 0,
    });
  });

  it('приватность: в ответе только числа и даты — ни идентификаторов заданий и курсов, ни оценок, ни времени', async () => {
    const { engine } = await seeded();
    const { stats } = engine.extensionHost;
    const answers = [
      await stats.streak('acme.stats'),
      await stats.streak('acme.stats', 'alpha'),
      await stats.daily('acme.stats', '2024-05-07', '2024-05-10'),
      await stats.daily('acme.stats', '2024-05-07', '2024-05-10', 'beta'),
    ];
    const text = JSON.stringify(answers);
    for (const secret of ['alpha', 'beta', 'e0', 'e1', '::', 'device']) {
      expect(text, secret).not.toContain(secret);
    }
    for (const answer of answers) {
      for (const item of Array.isArray(answer) ? answer : [answer]) {
        for (const [key, value] of Object.entries(item)) {
          expect(
            ['current', 'longest', 'date', 'attempts', 'correct', 'accuracy'],
            key,
          ).toContain(key);
          expect(
            typeof value === 'number' ||
              value === null ||
              (key === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(String(value))),
          ).toBe(true);
        }
      }
    }
  });

  it('новая попытка сразу видна; сброс прогресса статистику не стирает', async () => {
    const t = await seeded();
    const { stats } = t.engine.extensionHost;
    await stats.streak('acme.stats');
    await study(t, 'beta::l::e0', 4, 0);
    expect(await stats.daily('acme.stats', '2024-05-10', '2024-05-10')).toEqual(
      [{ date: '2024-05-10', attempts: 2, correct: 2, accuracy: 1 }],
    );

    await t.engine.practice.resetProgress({
      unitId: 'alpha',
      requestId: 'reset-1',
    });
    expect(
      await stats.daily('acme.stats', '2024-05-07', '2024-05-07', 'alpha'),
    ).toEqual([{ date: '2024-05-07', attempts: 2, correct: 1, accuracy: 0.5 }]);
  });

  it('записи, применённые синхронизацией или импортом, и перестройка проекций тоже сбрасывают индекс', async () => {
    const t = await seeded();
    const { stats } = t.engine.extensionHost;
    expect(await stats.streak('acme.stats')).toMatchObject({ longest: 2 });
    const at = NOON - 4 * DAY;
    const entry = {
      kind: 'attempt' as const,
      id: 'foreign-1',
      deviceId: 'device-b',
      seq: 1,
      at,
      recordedAt: at,
      exerciseId: 'beta::l::e0',
      grade: 4 as const,
      source: 'self' as const,
    };
    await t.eventStore.append([entry]);
    t.ctx.applyEntries([entry]);
    // 6 мая добавилось к серии 7 мая: 6, 7, (8 пуст) — longest не растёт, но день появился
    expect(await stats.daily('acme.stats', '2024-05-06', '2024-05-06')).toEqual(
      [{ date: '2024-05-06', attempts: 1, correct: 1, accuracy: 1 }],
    );

    const late = { ...entry, id: 'foreign-2', seq: 2, at: NOON - 5 * DAY };
    await t.eventStore.append([late]);
    await t.ctx.rebuild();
    expect(await stats.daily('acme.stats', '2024-05-05', '2024-05-05')).toEqual(
      [{ date: '2024-05-05', attempts: 1, correct: 1, accuracy: 1 }],
    );
  });
});

describe('границы запроса', () => {
  it('диапазон: ровно 366 дат допустимо, 367 и обратный — INVALID_ARGUMENT; даты проверяются по календарю', async () => {
    const { engine } = await seeded();
    const { stats } = engine.extensionHost;
    expect(
      await stats.daily('acme.stats', '2023-05-10', '2024-05-09'),
    ).toHaveLength(366);
    for (const [from, to] of [
      ['2023-05-09', '2024-05-09'],
      ['2024-05-10', '2024-05-09'],
    ] as const) {
      const error = await rejection(stats.daily('acme.stats', from, to));
      expect(error.code, `${from}..${to}`).toBe('INVALID_ARGUMENT');
      expect(error.details).toMatchObject({ field: 'to', maxDays: 366 });
    }
    for (const bad of ['2025-02-30', '2024-5-1', 'yesterday', '']) {
      const error = await rejection(
        stats.daily('acme.stats', bad, '2025-03-01'),
      );
      expect(error.details, bad).toEqual({ field: 'from' });
    }
    expect(
      (await rejection(stats.daily('acme.stats', '2024-05-01', '2024-13-01')))
        .details,
    ).toEqual({ field: 'to' });
  });

  it('значения не той формы с границы процесса отклоняются, а не приводятся', async () => {
    const { engine } = await seeded();
    const { stats } = engine.extensionHost;
    const forged = stats as unknown as {
      daily(...args: unknown[]): Promise<unknown>;
      streak(...args: unknown[]): Promise<unknown>;
    };
    expect((await rejection(forged.streak('acme.stats', 7))).details).toEqual({
      field: 'courseId',
    });
    expect(
      (await rejection(forged.daily('acme.stats', 20240501, '2024-05-02')))
        .details,
    ).toEqual({ field: 'from' });
  });
});

describe('часовой пояс процесса', () => {
  it('смена TZ пересобирает индекс: попытка у полуночи переезжает в другие сутки', async () => {
    const t = await open();
    await study(t, 'alpha::l::e0', 4, 0); // 12:00 UTC — одни сутки в любом поясе рядом
    t.clock.set(Date.UTC(2024, 4, 10, 23, 30));
    await t.engine.practice.recordAttempt({
      requestId: 'late',
      exerciseId: 'alpha::l::e1',
      grade: 4,
    });
    const { stats } = t.engine.extensionHost;
    const attemptsOn = async (date: string) =>
      (await stats.daily('acme.stats', date, date))[0]?.attempts;
    expect(await attemptsOn('2024-05-10')).toBe(2);
    process.env.TZ = 'Asia/Tokyo'; // 23:30 UTC = 08:30 11 мая
    try {
      expect(await attemptsOn('2024-05-10')).toBe(1);
      expect(await attemptsOn('2024-05-11')).toBe(1);
    } finally {
      process.env.TZ = 'UTC';
    }
  });
});
