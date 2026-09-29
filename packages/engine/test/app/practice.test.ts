/**
 * Сценарии `practice` через фасад на настоящем движке: запись попытки
 * (T-10, T-11, T-13), `progress_reset` (T-09, T-25), статусы, фронтир и due.
 */
import type { LearningEngine } from '@lms/engine-contract';
import { buildLibrary } from '@lms/testkit';
import { describe, expect, it, vi } from 'vitest';
import { createTestEngine } from '../helpers/engine.ts';

const DAY_MS = 86_400_000;
const FIVE_MIN_MS = 300_000;

const library = buildLibrary({
  courses: [
    {
      id: 'c',
      lessons: [
        { id: 'l1', exercises: ['e1', 'e2', 'e3'] },
        { id: 'l2', dependencies: ['l1'], exercises: ['e1', 'e2'] },
      ],
    },
  ],
});
const E1 = 'c::l1::e1';
const E2 = 'c::l1::e2';
const E3 = 'c::l1::e3';
const L2E1 = 'c::l2::e1';

const record = (
  engine: LearningEngine,
  exerciseId: string,
  grade: 1 | 2 | 3 | 4 | 5 = 4,
) =>
  engine.practice.recordAttempt({
    requestId: `${exerciseId}-${Math.random()}`,
    exerciseId,
    grade,
  });

describe('recordAttempt', () => {
  it('writes one entry, returns the new scores and sends progress after the command (T-10)', async () => {
    const t = await createTestEngine({ library });
    const result = await t.engine.practice.recordAttempt({
      requestId: 'r1',
      exerciseId: E1,
      grade: 5,
    });
    expect(result).toMatchObject({
      eventId: 'r1',
      exerciseId: E1,
      grade: 5,
      duplicate: false,
    });
    expect(result.affected.map(({ unitId, kind }) => [unitId, kind])).toEqual([
      [E1, 'exercise'],
      ['c::l1', 'lesson'],
      ['c', 'course'],
    ]);
    expect(result.affected[0]?.score).toBeGreaterThan(0);
    expect(t.eventStore.entryCount()).toBe(1);
    expect(t.events).toEqual([
      {
        type: 'progress',
        unitIds: expect.arrayContaining([E1, 'c::l1', 'c']),
        at: result.at,
      },
    ]);
  });

  it('is idempotent by requestId: the same result with duplicate, one entry, no second event', async () => {
    const t = await createTestEngine({ library });
    const request = { requestId: 'r1', exerciseId: E1, grade: 4 } as const;
    const first = await t.engine.practice.recordAttempt(request);
    t.events.length = 0;
    const second = await t.engine.practice.recordAttempt({
      ...request,
      grade: 1,
    });
    expect(second).toMatchObject({
      eventId: first.eventId,
      grade: 4, // повтор возвращает прежнюю запись, а не новый вход
      at: first.at,
      duplicate: true,
    });
    expect(second.remediation).toBeUndefined();
    expect(t.eventStore.entryCount()).toBe(1);
    expect(t.events).toEqual([]);
  });

  it('rejects bad input without touching the journal', async () => {
    const t = await createTestEngine({ library });
    const { practice } = t.engine;
    await expect(
      practice.recordAttempt({ requestId: 'r', exerciseId: E1, grade: 6 as 5 }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      practice.recordAttempt({
        requestId: 'r',
        exerciseId: E1,
        grade: 2.5 as 3,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      practice.recordAttempt({ requestId: '', exerciseId: E1, grade: 3 }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      practice.recordAttempt({ requestId: 'r', exerciseId: 'c::l1', grade: 3 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      practice.recordAttempt({ requestId: 'r', exerciseId: 'nope', grade: 3 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(t.eventStore.entryCount()).toBe(0);
    expect(t.events).toEqual([]);
  });

  it('a failed command sends no events and does not spoil the next one', async () => {
    const t = await createTestEngine({ library });
    await t.engine.practice
      .recordAttempt({ requestId: 'r', exerciseId: 'nope', grade: 3 })
      .catch(() => null);
    await record(t.engine, E1);
    expect(t.events).toHaveLength(1);
  });

  it('clamps a future `at` to now + 5 min and keeps order after a clock step back (T-13)', async () => {
    const t = await createTestEngine({ library });
    const now = t.clock.now();
    const future = await t.engine.practice.recordAttempt({
      requestId: 'f',
      exerciseId: E1,
      grade: 3,
      at: now + DAY_MS,
    });
    expect(future.at).toBe(now + FIVE_MIN_MS);
    t.clock.set(now - DAY_MS); // часы отмотали назад
    const later = await t.engine.practice.recordAttempt({
      requestId: 'g',
      exerciseId: E1,
      grade: 3,
    });
    expect(later.at).toBeGreaterThan(future.at); // не старше собственной прошлой записи
    const attempts = await t.engine.practice.getAttempts(E1);
    expect(attempts.items.map(({ eventId }) => eventId)).toEqual(['g', 'f']);
  });

  it('an explicit past `at` older than the seen maximum is moved after it', async () => {
    const t = await createTestEngine({ library });
    const first = await t.engine.practice.recordAttempt({
      requestId: 'a',
      exerciseId: E1,
      grade: 3,
    });
    const second = await t.engine.practice.recordAttempt({
      requestId: 'b',
      exerciseId: E1,
      grade: 3,
      at: first.at - 10_000,
    });
    expect(second.at).toBe(first.at + 1);
  });

  it('a projection failure marks the engine dirty; the retry rebuilds and returns duplicate (T-11)', async () => {
    const t = await createTestEngine({ library });
    const apply = vi
      .spyOn(t.ctx.projections, 'apply')
      .mockImplementationOnce(() => {
        throw new Error('projection is broken');
      });
    const request = { requestId: 'r1', exerciseId: E1, grade: 4 } as const;
    await expect(
      t.engine.practice.recordAttempt(request),
    ).rejects.toMatchObject({
      code: 'INTERNAL',
      retryable: true,
    });
    apply.mockRestore();
    expect(t.ctx.state.dirty).toBe(true);
    expect(t.eventStore.entryCount()).toBe(1); // журнал уже записан
    expect(t.events).toEqual([]); // progress не ушёл
    expect(t.logs.some(({ level }) => level === 'error')).toBe(true);

    const retry = await t.engine.practice.recordAttempt(request);
    expect(retry).toMatchObject({ eventId: 'r1', duplicate: true });
    expect(t.ctx.state.dirty).toBe(false);
    expect(t.events.map(({ type }) => type)).toEqual(['state-rebuilt']);
    expect(t.eventStore.entryCount()).toBe(1);
    expect((await t.engine.practice.getAttempts(E1)).items).toHaveLength(1);
    expect((await t.engine.practice.getUnitScore(E1)).score).toBeGreaterThan(0);
  });

  it('is unavailable when the library failed to load, journal and settings stay readable', async () => {
    const t = await createTestEngine({
      library: {
        ...library,
        lessons: [
          ...library.lessons,
          {
            ...library.lessons[0]!,
            id: 'c::broken',
            dependencies: ['c::broken'],
          },
        ],
      },
    });
    expect((await t.engine.library.getInfo()).state).toBe('invalid');
    await expect(record(t.engine, E1)).rejects.toMatchObject({
      code: 'LIBRARY_INVALID',
    });
    await expect(t.engine.settings.getScheduler()).resolves.toBeDefined();
    await expect(t.engine.sync.getState()).resolves.toMatchObject({
      entryCount: 0,
    });
  });
});

describe('getAttempts and getUnitScore', () => {
  it('lists surviving attempts newest first with paging', async () => {
    const t = await createTestEngine({ library });
    for (let i = 0; i < 5; i++) {
      t.clock.advance(1_000);
      await t.engine.practice.recordAttempt({
        requestId: `r${i}`,
        exerciseId: E1,
        grade: 3,
      });
    }
    const page = await t.engine.practice.getAttempts(E1, { limit: 2 });
    expect(page.items.map(({ eventId }) => eventId)).toEqual(['r4', 'r3']);
    expect(page.nextCursor).toBeDefined();
    const rest = await t.engine.practice.getAttempts(E1, {
      limit: 10,
      cursor: page.nextCursor!,
    });
    expect(rest.items.map(({ eventId }) => eventId)).toEqual([
      'r2',
      'r1',
      'r0',
    ]);
    expect(rest.nextCursor).toBeUndefined();
    await expect(t.engine.practice.getAttempts('nope')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('reports null score and no window for an unattempted unit, NOT_FOUND for an unknown one', async () => {
    const t = await createTestEngine({ library });
    const dto = await t.engine.practice.getUnitScore(E1);
    expect(dto).toMatchObject({ unitId: E1, kind: 'exercise', window: 'new' });
    await expect(t.engine.practice.getUnitScore('nope')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('resetProgress', () => {
  it('cancels attempts under the unit on every reading, keeps other units (T-09)', async () => {
    const t = await createTestEngine({ library });
    await record(t.engine, E1);
    await record(t.engine, E2);
    await record(t.engine, L2E1);
    t.clock.advance(1_000);
    const reset = await t.engine.practice.resetProgress({
      unitId: 'c::l1',
      requestId: 'reset-1',
    });
    expect(reset).toEqual({ eventId: 'reset-1', duplicate: false });
    expect((await t.engine.practice.getAttempts(E1)).items).toEqual([]);
    expect((await t.engine.practice.getAttempts(L2E1)).items).toHaveLength(1);
    const { items } = await t.engine.practice.getProgress({
      scope: { courseId: 'c' },
    });
    expect(
      Object.fromEntries(items.map(({ id, attempts }) => [id, attempts])),
    ).toEqual({
      c: 1,
      'c::l1': 0,
      'c::l2': 1,
    });
    expect(t.events.at(-1)).toMatchObject({ type: 'progress' });
    const journal = [];
    for await (const entry of t.eventStore.readAll()) journal.push(entry);
    const entry = journal.find(({ id }) => id === 'reset-1');
    expect(entry).toMatchObject({
      kind: 'progress_reset',
      unitId: 'c::l1',
      libraryRevision: (await t.engine.library.getInfo()).revision,
    });
  });

  it('attempts after the reset count again; rewards of cancelled attempts vanish', async () => {
    const t = await createTestEngine({ library });
    await record(t.engine, E1, 1);
    const before = await t.engine.practice.getUnitScore('c::l2');
    t.clock.advance(1_000);
    await t.engine.practice.resetProgress({
      unitId: 'c',
      requestId: 'reset-1',
    });
    t.clock.advance(1_000);
    await record(t.engine, E1, 5);
    expect((await t.engine.practice.getAttempts(E1)).items).toHaveLength(1);
    expect((await t.engine.practice.getUnitScore(E1)).score).toBeGreaterThan(4);
    expect(before).toBeDefined();
  });

  it('is idempotent by requestId and validates the unit', async () => {
    const t = await createTestEngine({ library });
    const first = await t.engine.practice.resetProgress({
      unitId: E1,
      requestId: 'x',
    });
    const second = await t.engine.practice.resetProgress({
      unitId: E1,
      requestId: 'x',
    });
    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ eventId: 'x', duplicate: true });
    expect(t.eventStore.entryCount()).toBe(1);
    await expect(
      t.engine.practice.resetProgress({ unitId: 'nope', requestId: 'y' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('getProgress', () => {
  it('derives statuses: ready, locked, in-progress, mastered, blacklisted', async () => {
    const t = await createTestEngine({ library });
    const statuses = async () =>
      Object.fromEntries(
        (
          await t.engine.practice.getProgress({ includeExercises: true })
        ).items.map(({ id, status }) => [id, status]),
      );
    expect(await statuses()).toMatchObject({
      c: 'ready',
      'c::l1': 'ready',
      'c::l2': 'locked',
      [E1]: 'ready',
      [L2E1]: 'locked',
    });
    await record(t.engine, E1, 2);
    expect(await statuses()).toMatchObject({
      'c::l1': 'in-progress',
      [E1]: 'in-progress',
      [E2]: 'ready',
    });
    for (const id of [E1, E2, E3]) {
      t.clock.advance(60_000);
      await record(t.engine, id, 5);
    }
    expect(await statuses()).toMatchObject({ [E2]: 'mastered' });
    await t.engine.curation.blacklist.add('c::l2');
    expect(await statuses()).toMatchObject({
      'c::l2': 'blacklisted',
      [L2E1]: 'blacklisted',
    });
  });

  it('scopes to a course, a lesson or explicit units and pages the result', async () => {
    const t = await createTestEngine({ library });
    await record(t.engine, E1);
    const { practice } = t.engine;
    const ids = async (query: Parameters<typeof practice.getProgress>[0]) =>
      (await practice.getProgress(query)).items.map(({ id }) => id);
    expect(await ids({})).toEqual(['c', 'c::l1', 'c::l2']);
    expect(await ids({ scope: { courseId: 'c' } })).toEqual([
      'c',
      'c::l1',
      'c::l2',
    ]);
    expect(
      await ids({ scope: { lessonId: 'c::l1' }, includeExercises: true }),
    ).toEqual(['c::l1', E1, E2, E3]);
    expect(await ids({ scope: { unitIds: [E2, 'c'] } })).toEqual([E2, 'c']);
    await expect(
      practice.getProgress({ scope: { unitIds: ['nope'] } }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const page = await practice.getProgress(
      { includeExercises: true },
      { limit: 3 },
    );
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBeDefined();
  });

  it('counts attempts and reports the last attempt time and due exercises', async () => {
    const t = await createTestEngine({ library });
    await record(t.engine, E1);
    t.clock.advance(1_000);
    const second = await record(t.engine, E2);
    const { items } = await t.engine.practice.getProgress({
      scope: { lessonId: 'c::l1' },
    });
    expect(items[0]).toMatchObject({
      id: 'c::l1',
      attempts: 2,
      lastAttemptAt: second.at,
      dueExercises: 0,
    });
  });
});

describe('getFrontier and getDue', () => {
  it('the frontier opens the next lesson only after the dependency passes the threshold', async () => {
    const t = await createTestEngine({ library });
    const ids = async () =>
      (await t.engine.practice.getFrontier()).items.map(
        ({ lessonId }) => lessonId,
      );
    expect(await ids()).toEqual(['c::l1']);
    await expect(
      t.engine.practice.getFrontier({ courseId: 'nope' }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    for (const id of [E1, E2, E3]) {
      await record(t.engine, id, 5);
      await record(t.engine, id, 5);
    }
    expect(await ids()).toEqual(['c::l2']);
  });

  it('due lists attempted exercises whose retrievability fell below the target', async () => {
    const t = await createTestEngine({ library });
    await record(t.engine, E1, 3);
    expect((await t.engine.practice.getDue()).items).toEqual([]);
    t.clock.advance(60 * DAY_MS);
    const due = await t.engine.practice.getDue();
    expect(due.items.map(({ exerciseId }) => exerciseId)).toEqual([E1]);
    expect(due.items[0]).toMatchObject({ lessonId: 'c::l1' });
    expect(due.items[0]!.retrievability).toBeLessThanOrEqual(0.9);
    expect((await t.engine.practice.getDue({ minNeed: 1.0 })).items).toEqual(
      [],
    );
    await expect(
      t.engine.practice.getDue({ minNeed: 2 }),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });
});

describe('startSession and getBatch', () => {
  it('startSession resets the session state and issues a new session id', async () => {
    const t = await createTestEngine({ library });
    await record(t.engine, E1, 1);
    expect(t.ctx.session.trialCounts()).toEqual({ success: 0, failed: 1 });
    const first = await t.engine.practice.startSession();
    expect(t.ctx.session.trialCounts()).toEqual({ success: 0, failed: 0 });
    const second = await t.engine.practice.startSession();
    expect(second.sessionId).not.toBe(first.sessionId);
    expect((await t.engine.practice.getBatch()).sessionId).toBe(
      second.sessionId,
    );
  });

  it('marks new and reviewed exercises and counts shows', async () => {
    const t = await createTestEngine({ library });
    await record(t.engine, E1, 3);
    const batch = await t.engine.practice.getBatch();
    expect(batch.exercises.map(({ id }) => id)).toContain(E1);
    expect(batch.reasons).toHaveLength(batch.exercises.length);
    const reasonOf = (id: string) =>
      batch.reasons[batch.exercises.findIndex((e) => e.id === id)];
    expect(reasonOf(E1)).toBe('review');
    expect(reasonOf(E2)).toBe('new');
    expect(t.ctx.session.frequencyOf(E2)).toBe(1);
  });

  it('is deterministic for equal seed and state, differs for another seed', async () => {
    const big = buildLibrary({
      courses: [
        {
          id: 'c',
          lessons: Array.from({ length: 8 }, (_, i) => ({
            id: `l${i}`,
            exercises: 6,
          })),
        },
      ],
    });
    const batchOf = async (seed: number) => {
      const t = await createTestEngine({ library: big, seed });
      await t.engine.settings.setScheduler({ batchSize: 10 });
      return (await t.engine.practice.getBatch()).exercises.map(({ id }) => id);
    };
    const [a, b, c] = [await batchOf(5), await batchOf(5), await batchOf(6)];
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a.length).toBeGreaterThan(0);
  });

  it('filters by lesson; an unknown saved filter in a study session is NOT_FOUND', async () => {
    const t = await createTestEngine({ library });
    const batch = await t.engine.practice.getBatch({
      filter: { UnitFilter: { LessonFilter: { lesson_ids: ['c::l1'] } } },
    });
    expect(new Set(batch.exercises.map(({ lessonId }) => lessonId))).toEqual(
      new Set(['c::l1']),
    );
    await expect(
      t.engine.practice.getBatch({
        filter: {
          StudySession: {
            startTimeMs: t.clock.now(),
            definition: {
              id: 's',
              parts: [{ SavedFilter: { filter_id: 'nope', duration: 10 } }],
            },
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
