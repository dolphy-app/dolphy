import type { PlacementSummaryDto } from '@dolphy-app/engine-contract';
import { buildLibrary, createFakeExerciseTypes } from '@dolphy-app/testkit';
import { describe, expect, test } from 'vitest';
import { EngineError } from '../../src/app/index.ts';
import type { EventStore, StoreTx } from '../../src/ports/index.ts';
import { createTestEngine } from '../helpers/engine.ts';
import type { TestEngine } from '../helpers/engine.ts';

const COURSE = 'sql_json';
const lessonId = (name: string) => `${COURSE}::${name}`;
/** Замкнутое по пререквизитам множество известных: select → ddl, where → select, aggregate → select. */
const TRUE_KNOWN = new Set(
  ['ddl', 'select', 'where', 'aggregate'].map(lessonId),
);
const EXERCISES_PER_LESSON = 3;
const DAY_MS = 86_400_000;

const codeOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    if (error instanceof EngineError) return error.code;
    throw error;
  }
  return null;
};

/** Проходит сессию безшумной самооценкой по истинному downset. */
const runSession = async (
  engine: TestEngine['engine'],
  sessionId: string,
  truth: ReadonlySet<string>,
) => {
  const probes: string[] = [];
  for (;;) {
    const probe = await engine.placement.nextProbe(sessionId);
    if (probe === null) return probes;
    probes.push(probe.lessonId);
    await engine.placement.answer({
      probeId: probe.probeId,
      result: { kind: 'grade', grade: truth.has(probe.lessonId) ? 5 : 1 },
    });
  }
};

const start = (test: TestEngine, seed = 5) =>
  test.engine.placement.start({ budget: 20, seed });

describe('placement service on sql-course (T-47)', () => {
  test('finish writes 2 attempts per exercise of known lessons and the gate opens exactly the frontier', async () => {
    const t = await createTestEngine({ library: 'sql-course' });
    const { sessionId, lessonCount } = await start(t);
    expect(lessonCount).toBe(7);
    await runSession(t.engine, sessionId, TRUE_KNOWN);
    const before = t.eventStore.entryCount();
    const summary = await t.engine.placement.finish({
      sessionId,
      requestId: 'finish-1',
    });
    expect(new Set(summary.known)).toEqual(TRUE_KNOWN);
    expect(summary.uncertain).toEqual([]);
    expect(summary.duplicate).toBe(false);
    expect(summary.attemptsWritten).toBe(
      TRUE_KNOWN.size * EXERCISES_PER_LESSON * 2,
    );
    expect(t.eventStore.entryCount() - before).toBe(summary.attemptsWritten);
    expect(summary.frontier).toEqual([lessonId('join')]);

    // журнал: source 'placement', по 2 попытки на упражнение, оценка 4
    for (const lesson of summary.known) {
      for (let e = 1; e <= EXERCISES_PER_LESSON; e++) {
        const page = await t.engine.practice.getAttempts(`${lesson}::q${e}`);
        expect(page.items.map((a) => [a.source, a.grade])).toEqual([
          ['placement', 4],
          ['placement', 4],
        ]);
      }
    }

    // настоящий гейт (UnitScorer) открывает ровно фронтир диагностики
    const frontier = await t.engine.practice.getFrontier();
    expect(frontier.items.map((item) => item.lessonId)).toEqual(
      summary.frontier,
    );
  });

  test('undo by the finish requestId withdraws the whole batch and redo restores it', async () => {
    const t = await createTestEngine({ library: 'sql-course' });
    const frontierOf = async () =>
      (await t.engine.practice.getFrontier()).items.map((i) => i.lessonId);
    const untouched = await frontierOf();
    const { sessionId } = await start(t);
    await runSession(t.engine, sessionId, TRUE_KNOWN);
    const summary = await t.engine.placement.finish({
      sessionId,
      requestId: 'finish-undo',
    });
    expect(await frontierOf()).toEqual(summary.frontier);
    const before = t.eventStore.entryCount();

    const undone = await t.engine.practice.undo({
      targetId: 'finish-undo',
      requestId: 'undo-1',
    });
    expect(undone).toMatchObject({ changed: true, duplicate: false });
    expect(t.eventStore.entryCount()).toBe(before + 1);
    expect(await frontierOf()).toEqual(untouched);
    for (const lesson of summary.known) {
      const page = await t.engine.practice.getAttempts(`${lesson}::q1`);
      expect(page.items).toEqual([]);
    }

    await t.engine.practice.redo({
      targetId: 'finish-undo',
      requestId: 'redo-1',
    });
    expect(await frontierOf()).toEqual(summary.frontier);
    const [lesson] = summary.known;
    expect(
      (await t.engine.practice.getAttempts(`${lesson}::q1`)).items,
    ).toHaveLength(2);
  });

  test('finish writes inferred attempts but announces none of them to extensions', async () => {
    const t = await createTestEngine({ library: 'sql-course' });
    const { sessionId } = await start(t);
    await runSession(t.engine, sessionId, TRUE_KNOWN);
    const summary = await t.engine.placement.finish({
      sessionId,
      requestId: 'finish-quiet',
    });
    expect(summary.attemptsWritten).toBeGreaterThan(0);
    expect(t.learning).toEqual([]);
  });

  test('finish is idempotent by requestId: no new entries, duplicate flag', async () => {
    const t = await createTestEngine({ library: 'sql-course' });
    const { sessionId } = await start(t);
    await runSession(t.engine, sessionId, TRUE_KNOWN);
    const first = await t.engine.placement.finish({
      sessionId,
      requestId: 'r',
    });
    const count = t.eventStore.entryCount();
    const second = await t.engine.placement.finish({
      sessionId,
      requestId: 'r',
    });
    expect(second).toEqual({ ...first, duplicate: true });
    expect(t.eventStore.entryCount()).toBe(count);
    expect(
      await codeOf(() =>
        t.engine.placement.finish({ sessionId, requestId: 'other' }),
      ),
    ).toBe('PLACEMENT_SESSION_NOT_FOUND');
    // abort завершённой сессии ничего не меняет: повтор finish по-прежнему идемпотентен
    await t.engine.placement.abort({ sessionId });
    expect(
      await t.engine.placement.finish({ sessionId, requestId: 'r' }),
    ).toEqual({ ...first, duplicate: true });
  });

  test('a failing append writes nothing; retry with the same requestId succeeds', async () => {
    const t = await createTestEngine({ library: 'sql-course' });
    const { sessionId } = await start(t);
    await runSession(t.engine, sessionId, TRUE_KNOWN);
    const store = t.eventStore as EventStore & {
      transact: EventStore['transact'];
    };
    const { append, transact } = store;
    let failures = 1;
    const fail = () => {
      if (failures-- > 0) throw new Error('disk full');
    };
    store.append = async (entries) => {
      fail();
      return append.call(store, entries);
    };
    store.transact = async <T>(work: (tx: StoreTx) => T): Promise<T> => {
      fail();
      return transact.call(store, work) as Promise<T>;
    };
    const before = t.eventStore.entryCount();
    await expect(
      t.engine.placement.finish({ sessionId, requestId: 'retry' }),
    ).rejects.toThrow();
    expect(t.eventStore.entryCount()).toBe(before);
    const summary = await t.engine.placement.finish({
      sessionId,
      requestId: 'retry',
    });
    expect(summary.attemptsWritten).toBe(
      TRUE_KNOWN.size * EXERCISES_PER_LESSON * 2,
    );
    expect(t.eventStore.entryCount() - before).toBe(summary.attemptsWritten);
  });

  test('same seed and same answers give the same probes; the seed is echoed', async () => {
    const run = async () => {
      const t = await createTestEngine({ library: 'sql-course' });
      const started = await start(t, 99);
      expect(started.seed).toBe(99);
      return runSession(t.engine, started.sessionId, TRUE_KNOWN);
    };
    const [a, b] = [await run(), await run()];
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  test('nextProbe returns the same probe until it is answered', async () => {
    const t = await createTestEngine({ library: 'sql-course' });
    const { sessionId } = await start(t);
    const first = await t.engine.placement.nextProbe(sessionId);
    expect(await t.engine.placement.nextProbe(sessionId)).toEqual(first);
    expect(first?.exerciseId.startsWith(`${first?.lessonId}::`)).toBe(true);
  });

  test('a host crash before finish loses the session and leaves the journal untouched', async () => {
    const first = await createTestEngine({ library: 'sql-course' });
    const { sessionId } = await start(first);
    const probe = await first.engine.placement.nextProbe(sessionId);
    await first.engine.placement.answer({
      probeId: probe?.probeId ?? '',
      result: { kind: 'grade', grade: 5 },
    });
    const entriesBefore = first.eventStore.entryCount();

    // «падение хоста»: сессия жила только в памяти процесса; журнал тот же
    const second = await createTestEngine({
      library: 'sql-course',
      eventStore: first.eventStore,
    });
    const { placement } = second.engine;
    expect(await codeOf(() => placement.nextProbe(sessionId))).toBe(
      'PLACEMENT_SESSION_NOT_FOUND',
    );
    expect(
      await codeOf(() => placement.finish({ sessionId, requestId: 'late' })),
    ).toBe('PLACEMENT_SESSION_NOT_FOUND');
    expect(second.eventStore.entryCount()).toBe(entriesBefore);
    expect(entriesBefore).toBe(0);
    // новая сессия стартует: старая не блокирует
    expect(await codeOf(() => placement.start({ budget: 5 }))).toBeNull();
  });

  test('validation, one active session, abort writes nothing, TTL 24 h', async () => {
    const t = await createTestEngine({ library: 'sql-course' });
    const { placement } = t.engine;
    for (const budget of [0, 201, 1.5, Number.NaN]) {
      expect(await codeOf(() => placement.start({ budget }))).toBe(
        'INVALID_ARGUMENT',
      );
    }
    expect(await codeOf(() => placement.start({ budget: 5, seed: -1 }))).toBe(
      'INVALID_ARGUMENT',
    );
    expect(
      await codeOf(() => placement.start({ budget: 5, courseIds: ['nope'] })),
    ).toBe('NOT_FOUND');

    const { sessionId } = await placement.start({ budget: 5 });
    expect(await codeOf(() => placement.start({ budget: 5 }))).toBe(
      'PLACEMENT_SESSION_ACTIVE',
    );
    const before = t.eventStore.entryCount();
    await placement.abort({ sessionId });
    expect(t.eventStore.entryCount()).toBe(before);
    expect(await codeOf(() => placement.nextProbe(sessionId))).toBe(
      'PLACEMENT_SESSION_NOT_FOUND',
    );
    // неизвестная и повторно прерванная сессии — no-op
    expect(await codeOf(() => placement.abort({ sessionId }))).toBeNull();
    expect(
      await codeOf(() => placement.abort({ sessionId: 'unknown' })),
    ).toBeNull();

    const second = await placement.start({ budget: 5 });
    t.clock.advance(DAY_MS + 1);
    expect(await codeOf(() => placement.nextProbe(second.sessionId))).toBe(
      'PLACEMENT_SESSION_NOT_FOUND',
    );
    // истёкшая сессия не блокирует новую
    expect(await codeOf(() => placement.start({ budget: 5 }))).toBeNull();
  });

  test('budget is respected; a stale probe is rejected', async () => {
    const t = await createTestEngine({ library: 'sql-course' });
    const { placement } = t.engine;
    const { sessionId } = await placement.start({ budget: 1, seed: 3 });
    const probe = await placement.nextProbe(sessionId);
    expect(probe).not.toBeNull();
    const progress = await placement.answer({
      probeId: probe?.probeId ?? '',
      result: { kind: 'grade', grade: 5 },
    });
    expect(progress.asked).toBe(1);
    expect(await placement.nextProbe(sessionId)).toBeNull();
    expect(
      await codeOf(() =>
        placement.answer({
          probeId: probe?.probeId ?? '',
          result: { kind: 'grade', grade: 5 },
        }),
      ),
    ).toBe('PLACEMENT_BUDGET_EXHAUSTED');
    expect(
      await codeOf(() =>
        placement.answer({
          probeId: 'garbage',
          result: { kind: 'grade', grade: 5 },
        }),
      ),
    ).toBe('INVALID_ARGUMENT');
  });

  test('an answered probe cannot be answered again, even with budget left', async () => {
    const t = await createTestEngine({ library: 'sql-course' });
    const { placement } = t.engine;
    const { sessionId } = await placement.start({ budget: 5, seed: 3 });
    const probe = await placement.nextProbe(sessionId);
    const request = {
      probeId: probe?.probeId ?? '',
      result: { kind: 'grade', grade: 5 },
    } as const;
    await placement.answer(request);
    expect(await codeOf(() => placement.answer(request))).toBe(
      'PLACEMENT_BUDGET_EXHAUSTED',
    );
  });

  test('an open attempt with a verdict is accepted as a result; grades are validated', async () => {
    const t = await createTestEngine({
      library: 'sql-course',
      exerciseTypes: createFakeExerciseTypes({ types: { 'dolphy.sql': {} } }),
    });
    const { placement, practice } = t.engine;
    const { sessionId } = await placement.start({ budget: 5, seed: 1 });
    const probe = await placement.nextProbe(sessionId);
    const exerciseId = probe?.exerciseId ?? '';
    const probeId = probe?.probeId ?? '';
    expect(
      await codeOf(() =>
        placement.answer({ probeId, result: { kind: 'grade', grade: 9 as 5 } }),
      ),
    ).toBe('INVALID_ARGUMENT');
    expect(
      await codeOf(() =>
        placement.answer({
          probeId,
          result: { kind: 'attempt', attemptId: 'x' },
        }),
      ),
    ).toBe('ATTEMPT_NOT_FOUND');

    const { attemptId } = await practice.beginAttempt({ exerciseId });
    // вердикта ещё нет
    expect(
      await codeOf(() =>
        placement.answer({ probeId, result: { kind: 'attempt', attemptId } }),
      ),
    ).toBe('INVALID_ARGUMENT');
    t.ctx.attempts.get(attemptId)?.verdicts.push({
      outcome: 'passed',
      attemptId,
      attemptsUsed: 1,
    } as never);
    const progress = await placement.answer({
      probeId,
      result: { kind: 'attempt', attemptId },
    });
    expect(progress.asked).toBe(1);
    // попытка закрыта без события: результата нет, в реестре её больше нет
    expect(t.ctx.attempts.get(attemptId)).toBeUndefined();
    expect((await practice.getAttempts(exerciseId)).items).toEqual([]);
  });
});

describe('placement feeds the day plan', () => {
  test('known lessons come back as reviews, the frontier lesson as new material', async () => {
    const t = await createTestEngine({ library: 'sql-course' });
    const { sessionId } = await start(t);
    await runSession(t.engine, sessionId, TRUE_KNOWN);
    await t.engine.placement.finish({ sessionId, requestId: 'plan' });
    t.clock.advance(3 * DAY_MS);
    const day = await t.engine.plan.getDay({ maxItems: 40, seed: 1 });
    const reviews = day.items.filter((item) => item.reason === 'review');
    const fresh = day.items.filter((item) => item.reason === 'new');
    expect(reviews.length).toBe(TRUE_KNOWN.size * EXERCISES_PER_LESSON);
    expect(
      reviews.every(({ exerciseId }) =>
        TRUE_KNOWN.has(exerciseId.split('::').slice(0, 2).join('::')),
      ),
    ).toBe(true);
    expect(fresh.map(({ exerciseId }) => exerciseId).sort()).toEqual(
      [1, 2, 3].map((q) => `${lessonId('join')}::q${q}`),
    );
  });
});

describe('placement on a library without verification (T-47)', () => {
  /** Цепочка a ← b ← c без `engine.exercise`: пробы самооценкой, `minPass = 2`. */
  const chain = buildLibrary({
    courses: [
      {
        id: 'k',
        lessons: [
          { id: 'a', exercises: 2 },
          { id: 'b', dependencies: ['a'], exercises: 2 },
          { id: 'c', dependencies: ['b'], exercises: 2 },
        ],
      },
    ],
  });

  test('one pass is not enough for known; two independent passes are', async () => {
    const t = await createTestEngine({ library: chain });
    const { placement } = t.engine;
    const { sessionId } = await placement.start({ budget: 3, seed: 1 });
    const first = await placement.nextProbe(sessionId);
    expect(first?.lessonId).toBe('k::b'); // середина цепочки из трёх
    const afterFirst = await placement.answer({
      probeId: first?.probeId ?? '',
      result: { kind: 'grade', grade: 5 },
    });
    // b и a получили по одному проходу: p высока, но независимого подтверждения нет
    expect(afterFirst.unresolved).toBe(3);
    const second = await placement.nextProbe(sessionId);
    expect(second?.lessonId).toBe('k::a');
    const afterSecond = await placement.answer({
      probeId: second?.probeId ?? '',
      result: { kind: 'grade', grade: 5 },
    });
    // a подтверждён проходом b и своим; у самого b пока одно подтверждение
    expect(afterSecond.unresolved).toBe(2);
    const third = await placement.nextProbe(sessionId);
    expect(third?.lessonId).toBe('k::c');
    await placement.answer({
      probeId: third?.probeId ?? '',
      result: { kind: 'grade', grade: 5 },
    });
    const summary = await placement.finish({ sessionId, requestId: 'r' });
    // проход c подтвердил b; сам c подтверждён один раз
    expect(summary.known).toEqual(['k::a', 'k::b']);
    expect(summary.uncertain).toEqual(['k::c']);
    expect(summary.frontier).toEqual(['k::c']);
  });

  test('a session with no known lesson writes nothing', async () => {
    const t = await createTestEngine({ library: chain });
    const { placement } = t.engine;
    const { sessionId } = await placement.start({ budget: 3, seed: 1 });
    await runSession(t.engine, sessionId, new Set());
    const before = t.eventStore.entryCount();
    const summary: PlacementSummaryDto = await placement.finish({
      sessionId,
      requestId: 'none',
    });
    expect(summary.known).toEqual([]);
    expect(summary.attemptsWritten).toBe(0);
    expect(summary.frontier).toEqual(['k::a']);
    expect(t.eventStore.entryCount()).toBe(before);
  });
});
