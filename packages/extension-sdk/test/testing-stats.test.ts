import { describe, expect, it } from 'vitest';
import {
  EXTENSION_STATS_LIMITS,
  PermissionError,
  defineExtension,
} from '../src/index.ts';
import { createMemoryStats, loadCommands, loadEvents } from '../src/testing.ts';

const NEW_YORK = 'America/New_York';
const NOW = Date.parse('2024-05-11T16:00:00Z');

describe('createMemoryStats', () => {
  it('counts local days in the time zone: an attempt just after local midnight is a new day', async () => {
    const stats = createMemoryStats({
      timeZone: NEW_YORK,
      now: () => NOW,
      attempts: [
        { at: '2024-03-10T04:59:59Z', grade: 4 }, // 23:59:59 EST on March 9
        { at: Date.parse('2024-03-10T05:00:00Z'), grade: 4 }, // 00:00:00 EST on March 10
      ],
    });

    expect(
      (await stats.daily({ from: '2024-03-09', to: '2024-03-10' })).map(
        (day) => [day.date, day.attempts],
      ),
    ).toEqual([
      ['2024-03-09', 1],
      ['2024-03-10', 1],
    ]);
  });

  it('streak: yesterday keeps `current` alive, a gap day breaks it, `longest` spans the history; the daylight-saving day is one day', async () => {
    const stats = createMemoryStats({
      timeZone: NEW_YORK,
      now: () => Date.parse('2024-03-12T14:00:00Z'), // March 12, no attempts yet
      attempts: [
        { at: '2024-03-06T17:00:00Z', grade: 4 },
        { at: '2024-03-07T17:00:00Z', grade: 4 },
        { at: '2024-03-08T17:00:00Z', grade: 4 },
        // March 9 skipped
        { at: '2024-03-10T17:00:00Z', grade: 4 }, // the 23-hour day
        { at: '2024-03-11T17:00:00Z', grade: 4 },
      ],
    });

    expect(await stats.streak()).toEqual({ current: 2, longest: 3 });

    stats.record({ at: '2024-03-12T13:00:00Z', grade: 1 });
    expect(await stats.streak()).toEqual({ current: 3, longest: 3 });
  });

  it('a correct attempt is grade 3 or higher; accuracy is null without attempts', async () => {
    const stats = createMemoryStats({
      timeZone: 'UTC',
      attempts: [
        { at: '2024-05-06T10:00:00Z', grade: 2 },
        { at: '2024-05-06T11:00:00Z', grade: 3 },
        { at: '2024-05-06T12:00:00Z', grade: 5 },
        { at: '2024-05-06T13:00:00Z', grade: 1 },
      ],
    });

    expect(await stats.daily({ from: '2024-05-05', to: '2024-05-07' })).toEqual(
      [
        { date: '2024-05-05', attempts: 0, correct: 0, accuracy: null },
        { date: '2024-05-06', attempts: 4, correct: 2, accuracy: 0.5 },
        { date: '2024-05-07', attempts: 0, correct: 0, accuracy: null },
      ],
    );
  });

  it('the course filter keeps only attempts of that course; an unknown course gives zeros', async () => {
    const stats = createMemoryStats({
      timeZone: 'UTC',
      now: () => Date.parse('2024-05-07T08:00:00Z'),
      attempts: [
        { at: '2024-05-06T10:00:00Z', grade: 4, courseId: 'alpha' },
        { at: '2024-05-06T11:00:00Z', grade: 1, courseId: 'beta' },
        { at: '2024-05-07T11:00:00Z', grade: 4, courseId: 'beta' },
        { at: '2024-05-07T12:00:00Z', grade: 4 },
      ],
    });

    expect(await stats.streak({ courseId: 'alpha' })).toEqual({
      current: 1,
      longest: 1,
    });
    expect(
      await stats.daily({
        from: '2024-05-06',
        to: '2024-05-06',
        courseId: 'beta',
      }),
    ).toEqual([{ date: '2024-05-06', attempts: 1, correct: 0, accuracy: 0 }]);
    expect(await stats.streak({ courseId: 'nope' })).toEqual({
      current: 0,
      longest: 0,
    });
  });

  it('rejects malformed, reversed and oversized ranges like the app', async () => {
    const stats = createMemoryStats({ timeZone: 'UTC' });

    expect(
      await stats.daily({ from: '2023-05-10', to: '2024-05-09' }),
    ).toHaveLength(EXTENSION_STATS_LIMITS.dailyDays);
    for (const [from, to] of [
      ['2023-05-09', '2024-05-09'],
      ['2024-05-10', '2024-05-09'],
      ['2025-02-30', '2025-03-01'],
      ['2024-5-1', '2024-05-02'],
    ] as const) {
      await expect(stats.daily({ from, to }), `${from}..${to}`).rejects.toThrow(
        Error,
      );
    }
  });

  it('with permitted: false every call rejects with PermissionError(learning.stats)', async () => {
    const stats = createMemoryStats({ permitted: false });

    for (const call of [
      () => stats.streak(),
      () => stats.daily({ from: '2024-05-01', to: '2024-05-02' }),
    ]) {
      const error = await call().catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(PermissionError);
      expect(error).toMatchObject({ permission: 'learning.stats' });
    }
  });

  it('record rejects an invalid time', () => {
    expect(() =>
      createMemoryStats().record({ at: 'not a time', grade: 4 }),
    ).toThrow('attempt.at');
  });
});

describe('stats in loaders', () => {
  const module = defineExtension({
    activate(ctx) {
      ctx.commands.register('x.report', async () => ({
        notify: JSON.stringify(await ctx.stats.streak()),
      }));
    },
  });

  it('loadCommands hands the extension the stats of the test', async () => {
    const stats = createMemoryStats({
      timeZone: 'UTC',
      now: () => Date.parse('2024-05-07T08:00:00Z'),
      attempts: [{ at: '2024-05-07T07:00:00Z', grade: 4 }],
    });
    const loaded = await loadCommands(module, { stats });

    expect(await loaded.run('x.report')).toMatchObject({
      kind: 'notify',
      text: '{"current":1,"longest":1}',
    });
  });

  it('by default the stats are empty, not missing; loadEvents accepts them too', async () => {
    const loaded = await loadCommands(module);
    expect(await loaded.run('x.report')).toMatchObject({
      kind: 'notify',
      text: '{"current":0,"longest":0}',
    });

    let seen: unknown;
    await loadEvents(
      defineExtension({
        activate: async (ctx) => {
          seen = await ctx.stats.streak();
        },
      }),
      {
        stats: createMemoryStats({
          timeZone: 'UTC',
          now: () => NOW,
          attempts: [{ at: NOW, grade: 4 }],
        }),
      },
    );
    expect(seen).toEqual({ current: 1, longest: 1 });
  });
});
