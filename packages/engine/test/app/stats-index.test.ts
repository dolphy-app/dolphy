/**
 * Индекс статистики расширений (спека extension-api-breadth-1, R8): местные
 * сутки, переход на летнее время, порог «верно», фильтр курса, сброс индекса.
 */
import { describe, expect, it } from 'vitest';
import { createStatsIndex } from '../../src/app/stats-index.ts';
import type { LogEntry } from '../../src/domain/journal.ts';
import {
  formatStatsDate,
  parseStatsDate,
} from '../../src/domain/learning-stats.ts';

const NEW_YORK = 'America/New_York';

let seq = 0;
const attempt = (iso: string, exerciseId: string, grade: number): LogEntry => {
  seq += 1;
  const at = Date.parse(iso);
  return {
    kind: 'attempt',
    id: `a${seq}`,
    deviceId: 'd',
    seq,
    at,
    recordedAt: at,
    exerciseId,
    grade: grade as 1,
    source: 'self',
  };
};

const reset = (iso: string, unitId: string): LogEntry => {
  seq += 1;
  const at = Date.parse(iso);
  return {
    kind: 'progress_reset',
    id: `r${seq}`,
    deviceId: 'd',
    seq,
    at,
    recordedAt: at,
    unitId,
  };
};

const day = (date: string): number => {
  const parsed = parseStatsDate(date);
  if (parsed === null) throw new Error(`bad date ${date}`);
  return parsed;
};

/** Хранилище из массива: `reads` считает проходы по журналу. */
const open = (
  entries: LogEntry[],
  options: { now: string; timeZone?: () => string },
) => {
  const state = { reads: 0, now: Date.parse(options.now) };
  const index = createStatsIndex({
    eventStore: {
      async *readAll() {
        state.reads += 1;
        for (const entry of [...entries]) yield entry;
      },
    },
    clock: { now: () => state.now },
    timeZone: options.timeZone ?? (() => NEW_YORK),
  });
  return { index, state, entries };
};

describe('сутки по часовому поясу пользователя', () => {
  it('граница местной полуночи делит попытки на два дня, а в UTC они в одном', async () => {
    const entries = [
      attempt('2024-03-10T04:59:59Z', 'c::l::a', 4), // 23:59:59 EST, 9 марта
      attempt('2024-03-10T05:00:00Z', 'c::l::b', 4), // 00:00:00 EST, 10 марта
    ];
    const local = open(entries, { now: '2024-03-10T12:00:00Z' });
    expect(
      (await local.index.daily(day('2024-03-09'), day('2024-03-10'))).map(
        (item) => [item.date, item.attempts],
      ),
    ).toEqual([
      ['2024-03-09', 1],
      ['2024-03-10', 1],
    ]);
    const utc = open(entries, {
      now: '2024-03-10T12:00:00Z',
      timeZone: () => 'UTC',
    });
    expect(
      (await utc.index.daily(day('2024-03-09'), day('2024-03-10'))).map(
        (item) => item.attempts,
      ),
    ).toEqual([0, 2]);
  });

  it('переход на летнее время: сутки в 23 часа не рвут серию, сутки 24 часа вокруг пропуска — рвут', async () => {
    // 10 марта 2024 в Нью-Йорке сутки в 23 часа (02:00 → 03:00)
    const spring = open(
      [
        attempt('2024-03-09T17:00:00Z', 'c::l::a', 4),
        attempt('2024-03-10T17:00:00Z', 'c::l::a', 4),
        attempt('2024-03-11T17:00:00Z', 'c::l::a', 4),
      ],
      { now: '2024-03-11T18:00:00Z' },
    );
    expect(await spring.index.streak()).toEqual({ current: 3, longest: 3 });

    // ровно 24 часа между попытками, но 10 марта пропущено целиком
    const skipped = open(
      [
        attempt('2024-03-10T04:30:00Z', 'c::l::a', 4), // 9 марта, 23:30 EST
        attempt('2024-03-11T04:30:00Z', 'c::l::a', 4), // 11 марта, 00:30 EDT
      ],
      { now: '2024-03-11T12:00:00Z' },
    );
    expect(await skipped.index.streak()).toEqual({ current: 1, longest: 1 });
    expect(
      (await skipped.index.daily(day('2024-03-09'), day('2024-03-11'))).map(
        (item) => item.attempts,
      ),
    ).toEqual([1, 0, 1]);

    // 3 ноября 2024 сутки в 25 часов (01:00 повторяется)
    const fall = open(
      [
        attempt('2024-11-02T16:00:00Z', 'c::l::a', 4),
        attempt('2024-11-03T16:00:00Z', 'c::l::a', 4),
        attempt('2024-11-04T16:00:00Z', 'c::l::a', 4),
      ],
      { now: '2024-11-04T17:00:00Z' },
    );
    expect(await fall.index.streak()).toEqual({ current: 3, longest: 3 });

    // две попытки внутри одних 25-часовых суток остаются в одном дне
    const doubled = open(
      [
        attempt('2024-11-03T04:30:00Z', 'c::l::a', 4), // 00:30 EDT
        attempt('2024-11-03T06:30:00Z', 'c::l::a', 4), // 01:30 EST (после перевода)
      ],
      { now: '2024-11-03T12:00:00Z' },
    );
    expect(
      await doubled.index.daily(day('2024-11-03'), day('2024-11-03')),
    ).toEqual([{ date: '2024-11-03', attempts: 2, correct: 2, accuracy: 1 }]);
  });
});

describe('серия', () => {
  const entries = [
    attempt('2024-05-06T12:00:00Z', 'c::l::a', 4),
    attempt('2024-05-07T12:00:00Z', 'c::l::a', 4),
    attempt('2024-05-08T12:00:00Z', 'c::l::a', 4),
    // 9 мая — пропуск
    attempt('2024-05-10T12:00:00Z', 'c::l::a', 4),
    attempt('2024-05-11T12:00:00Z', 'c::l::a', 4),
  ];

  it('сегодня есть попытки: серия оканчивается сегодня; longest — самая длинная за всё время', async () => {
    const { index } = open(entries, { now: '2024-05-11T20:00:00Z' });
    expect(await index.streak()).toEqual({ current: 2, longest: 3 });
  });

  it('сегодня попыток ещё нет: считается серия до вчера и не обрывается', async () => {
    const { index } = open(entries, { now: '2024-05-12T14:00:00Z' });
    expect(await index.streak()).toEqual({ current: 2, longest: 3 });
  });

  it('день без попыток разрывает серию: позавчерашняя серия при пустых вчера и сегодня — current 0', async () => {
    const { index } = open(entries, { now: '2024-05-13T14:00:00Z' });
    expect(await index.streak()).toEqual({ current: 0, longest: 3 });
  });

  it('нет попыток вовсе — нули', async () => {
    const { index } = open([], { now: '2024-05-13T14:00:00Z' });
    expect(await index.streak()).toEqual({ current: 0, longest: 0 });
  });
});

describe('попытки за день', () => {
  const entries = [
    attempt('2024-05-06T10:00:00Z', 'alpha::l::a', 2),
    attempt('2024-05-06T11:00:00Z', 'alpha::l::b', 3),
    attempt('2024-05-06T12:00:00Z', 'beta::l::a', 5),
    attempt('2024-05-06T13:00:00Z', 'beta::l::a', 1),
    attempt('2024-05-08T13:00:00Z', 'alpha::l::a', 4),
  ];
  const range = (from: string, to: string) => [day(from), day(to)] as const;

  it('оценка 3 верна, 2 — нет; accuracy = верные / попытки, null без попыток; запись на каждую дату диапазона', async () => {
    const { index } = open(entries, { now: '2024-05-09T10:00:00Z' });
    expect(await index.daily(...range('2024-05-05', '2024-05-09'))).toEqual([
      { date: '2024-05-05', attempts: 0, correct: 0, accuracy: null },
      { date: '2024-05-06', attempts: 4, correct: 2, accuracy: 0.5 },
      { date: '2024-05-07', attempts: 0, correct: 0, accuracy: null },
      { date: '2024-05-08', attempts: 1, correct: 1, accuracy: 1 },
      { date: '2024-05-09', attempts: 0, correct: 0, accuracy: null },
    ]);
  });

  it('фильтр курса берёт попытки только этого курса, как в серии; неизвестный курс — нули', async () => {
    const { index } = open(entries, { now: '2024-05-09T10:00:00Z' });
    expect(
      await index.daily(...range('2024-05-06', '2024-05-06'), 'alpha'),
    ).toEqual([{ date: '2024-05-06', attempts: 2, correct: 1, accuracy: 0.5 }]);
    // у alpha попытки 6 и 8 мая: вчера (8-го) была — current 1, но 7-е пусто — longest 1
    expect(await index.streak('alpha')).toEqual({ current: 1, longest: 1 });
    expect(
      await index.daily(...range('2024-05-06', '2024-05-06'), 'nope'),
    ).toEqual([
      { date: '2024-05-06', attempts: 0, correct: 0, accuracy: null },
    ]);
    expect(await index.streak('nope')).toEqual({ current: 0, longest: 0 });
    // префикс курса — до первого `::`, а не подстрока
    expect(await index.streak('alph')).toEqual({ current: 0, longest: 0 });
  });

  it('progress_reset в счёт не входит: попытки сброшенного курса остаются в истории', async () => {
    const { index } = open(
      [...entries, reset('2024-05-07T09:00:00Z', 'alpha')],
      { now: '2024-05-09T10:00:00Z' },
    );
    expect(
      await index.daily(...range('2024-05-06', '2024-05-06'), 'alpha'),
    ).toEqual([{ date: '2024-05-06', attempts: 2, correct: 1, accuracy: 0.5 }]);
    expect(await index.streak()).toEqual({ current: 1, longest: 1 });
  });
});

describe('кэш', () => {
  const NOW = '2024-05-09T10:00:00Z';

  it('журнал читается один раз на любое число запросов; invalidate строит индекс заново и подхватывает новые попытки', async () => {
    const { index, state, entries } = open(
      [attempt('2024-05-09T08:00:00Z', 'c::l::a', 4)],
      { now: NOW },
    );
    expect(await index.streak()).toEqual({ current: 1, longest: 1 });
    await index.streak('c');
    await index.daily(day('2024-05-09'), day('2024-05-09'));
    expect(state.reads).toBe(1);

    entries.push(attempt('2024-05-08T08:00:00Z', 'c::l::a', 4));
    // без invalidate ответ тот же — индекс не перечитывает журнал сам
    expect(await index.streak()).toEqual({ current: 1, longest: 1 });
    index.invalidate();
    expect(await index.streak()).toEqual({ current: 2, longest: 2 });
    expect(state.reads).toBe(2);
  });

  it('смена часового пояса процесса пересобирает индекс', async () => {
    let zone = NEW_YORK;
    const { index, state } = open(
      [attempt('2024-05-09T03:00:00Z', 'c::l::a', 4)], // 8 мая 23:00 в Нью-Йорке, 9 мая в UTC
      { now: NOW, timeZone: () => zone },
    );
    expect(await index.daily(day('2024-05-08'), day('2024-05-09'))).toEqual([
      { date: '2024-05-08', attempts: 1, correct: 1, accuracy: 1 },
      { date: '2024-05-09', attempts: 0, correct: 0, accuracy: null },
    ]);
    zone = 'UTC';
    expect(await index.daily(day('2024-05-08'), day('2024-05-09'))).toEqual([
      { date: '2024-05-08', attempts: 0, correct: 0, accuracy: null },
      { date: '2024-05-09', attempts: 1, correct: 1, accuracy: 1 },
    ]);
    expect(state.reads).toBe(2);
  });

  it('параллельные первые запросы делят один проход по журналу', async () => {
    const { index, state } = open(
      [attempt('2024-05-09T08:00:00Z', 'c::l::a', 4)],
      { now: NOW },
    );
    const answers = await Promise.all([
      index.streak(),
      index.streak('c'),
      index.daily(day('2024-05-09'), day('2024-05-09')),
    ]);
    expect(answers[0]).toEqual({ current: 1, longest: 1 });
    expect(state.reads).toBe(1);
  });

  it('запись, пришедшая во время прохода, не теряется: проход повторяется', async () => {
    const entries = [attempt('2024-05-09T08:00:00Z', 'c::l::a', 4)];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    const index = createStatsIndex({
      eventStore: {
        async *readAll() {
          reads += 1;
          const snapshot = [...entries];
          // первый проход «зависает» посреди чтения, пока приходит новая запись
          if (reads === 1) await gate;
          for (const entry of snapshot) yield entry;
        },
      },
      clock: { now: () => Date.parse(NOW) },
      timeZone: () => NEW_YORK,
    });
    const pending = index.streak();
    await Promise.resolve();
    entries.push(attempt('2024-05-08T08:00:00Z', 'c::l::a', 4));
    index.invalidate();
    release();
    expect(await pending).toEqual({ current: 2, longest: 2 });
    expect(reads).toBe(2);
  });

  it('сбой чтения журнала не залипает: следующий запрос пробует снова', async () => {
    let fail = true;
    const index = createStatsIndex({
      eventStore: {
        async *readAll() {
          if (fail) throw new Error('boom');
          yield attempt('2024-05-09T08:00:00Z', 'c::l::a', 4);
        },
      },
      clock: { now: () => Date.parse(NOW) },
      timeZone: () => NEW_YORK,
    });
    await expect(index.streak()).rejects.toThrow('boom');
    fail = false;
    expect(await index.streak()).toEqual({ current: 1, longest: 1 });
  });
});

describe('даты', () => {
  it('parseStatsDate принимает только существующие даты YYYY-MM-DD и возвращается в ту же строку', () => {
    for (const date of ['2024-02-29', '2024-12-31', '1999-01-01']) {
      expect(formatStatsDate(parseStatsDate(date) as number)).toBe(date);
    }
    for (const bad of [
      '2025-02-29',
      '2024-13-01',
      '2024-00-10',
      '2024-04-31',
      '2024-5-1',
      '2024-05-01T00:00:00Z',
      ' 2024-05-01',
      '',
      20240501,
      null,
    ]) {
      expect(parseStatsDate(bad), String(bad)).toBeNull();
    }
  });
});
