/**
 * `createEngine` целиком: открытие, диагностика, восстановление проекций из
 * журнала, ремедиация через фасад (T-55 е, з), закрытие.
 */
import type { LearningEngine } from '@lms/engine-contract';
import { CONTRACT_VERSION } from '@lms/engine-contract';
import { buildAttempt, createFakeClock, T0_MS } from '@lms/testkit';
import { describe, expect, it, vi } from 'vitest';
import { createEngine } from '../../src/app/index.ts';
import {
  createMemoryEventStore,
  createNodeFsCourseSource,
} from '../../src/node/index.ts';
import { createTestEngine } from '../helpers/engine.ts';

const idsOf = async (engine: LearningEngine, lessonId: string) =>
  (await engine.library.listExercises(lessonId)).items.map(({ id }) => id);

describe('createEngine', () => {
  it('opens an empty profile: ready library, no events, not dirty', async () => {
    const t = await createTestEngine({ library: 'sql-course' });
    expect(await t.engine.library.getInfo()).toMatchObject({
      state: 'ready',
      counts: { courses: 1, lessons: 7, exercises: 21 },
    });
    expect(t.events).toEqual([]);
    expect(t.ctx.state).toEqual({ dirty: false, closed: false });
  });

  it('a missing library root opens as invalid with E_IO, the journal and settings stay usable', async () => {
    const t = await createTestEngine({
      library: createNodeFsCourseSource('/nonexistent/library-root'),
    });
    expect(await t.engine.library.getInfo()).toMatchObject({
      state: 'invalid',
      diagnostics: { errors: 1 },
    });
    const { items } = await t.engine.library.getDiagnostics();
    expect(items).toEqual([
      expect.objectContaining({ code: 'E_IO', severity: 'error' }),
    ]);
    await expect(t.engine.practice.getBatch()).rejects.toMatchObject({
      code: 'LIBRARY_INVALID',
    });
    await expect(t.engine.settings.getScheduler()).resolves.toBeDefined();
    await expect(t.engine.sync.getState()).resolves.toMatchObject({
      entryCount: 0,
    });
  });

  it('rebuilds the projections from an existing journal on open', async () => {
    const exerciseId = 'sql_json::ddl::q1';
    const entries = [1, 2, 3].map((seq) =>
      buildAttempt({
        exerciseId,
        grade: 4,
        seq,
        at: T0_MS - (10 - seq) * 60_000,
      }),
    );
    const t = await createTestEngine({
      library: 'sql-course',
      eventStore: createMemoryEventStore({ entries }),
    });
    const attempts = await t.engine.practice.getAttempts(exerciseId);
    expect(attempts.items).toHaveLength(3);
    expect(
      (await t.engine.practice.getUnitScore(exerciseId)).score,
    ).toBeGreaterThan(0);
    expect((await t.engine.practice.getProgress()).items[0]).toMatchObject({
      id: 'sql_json',
      attempts: 3,
    });
    expect(t.events).toEqual([]); // открытие — не команда: события не рассылаются
  });

  it('a second engine over the same journal sees the same state', async () => {
    const store = createMemoryEventStore();
    const first = await createTestEngine({
      library: 'sql-course',
      eventStore: store,
    });
    await first.engine.practice.recordAttempt({
      requestId: 'a',
      exerciseId: 'sql_json::ddl::q1',
      grade: 5,
    });
    await first.engine.curation.blacklist.add('sql_json::window');
    const second = await createTestEngine({
      library: 'sql-course',
      eventStore: store,
      clock: first.clock,
    });
    expect(
      await second.engine.practice.getUnitScore('sql_json::ddl::q1'),
    ).toEqual(await first.engine.practice.getUnitScore('sql_json::ddl::q1'));
    expect((await second.engine.curation.blacklist.list()).items).toEqual([
      'sql_json::window',
    ]);
  });

  it('diagnostics reports counters, timings and cache after some work', async () => {
    const t = await createTestEngine({ library: 'sql-course' });
    await t.engine.practice.recordAttempt({
      requestId: 'a',
      exerciseId: 'sql_json::ddl::q1',
      grade: 5,
    });
    await t.engine.practice.getBatch();
    const diagnostics = await t.engine.diagnostics();
    expect(diagnostics).toMatchObject({
      contractVersion: CONTRACT_VERSION,
      entryCount: 1,
      dirty: false,
      timings: { batch: { count: 1 } },
    });
    expect(diagnostics.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(diagnostics.cache.entries).toBeGreaterThan(0);
    expect(diagnostics.cache.exerciseHitRatio).toBeGreaterThan(0);
    expect(diagnostics.cache.exerciseHitRatio).toBeLessThanOrEqual(1);
    expect(diagnostics.timings.recordAttemptP95Ms).toBeGreaterThanOrEqual(0);
  });

  it('builds through createEngine(deps, config) like the host does', async () => {
    const t = await createTestEngine({ library: 'embedded' });
    const engine = await createEngine(t.deps, {
      libraryRoot: t.source.root,
      dataDir: '/tmp/engine-test-data',
    });
    expect((await engine.library.getInfo()).state).toBe('ready');
  });

  it('close waits for the running command and refuses new ones', async () => {
    const t = await createTestEngine({ library: 'sql-course' });
    const running = t.engine.practice.recordAttempt({
      requestId: 'a',
      exerciseId: 'sql_json::ddl::q1',
      grade: 3,
    });
    const closing = t.engine.close();
    await expect(running).resolves.toMatchObject({ duplicate: false });
    await closing;
    await expect(t.engine.diagnostics()).rejects.toMatchObject({
      code: 'ENGINE_CLOSED',
    });
    await expect(t.eventStore.append([])).rejects.toMatchObject({
      code: 'ENGINE_CLOSED',
    });
  });

  it('serialises commands in call order', async () => {
    const t = await createTestEngine({
      library: 'sql-course',
      clock: createFakeClock(),
    });
    const ids = await idsOf(t.engine, 'sql_json::ddl');
    const results = await Promise.all(
      ids.map((exerciseId, i) =>
        t.engine.practice.recordAttempt({
          requestId: `r${i}`,
          exerciseId,
          grade: 3,
        }),
      ),
    );
    expect(results.map(({ at }) => at)).toEqual(
      [...results.map(({ at }) => at)].sort((a, b) => a - b),
    );
    expect(new Set(results.map(({ at }) => at)).size).toBe(ids.length); // HLC: at растёт
    expect(t.events.map(({ type }) => type)).toEqual(ids.map(() => 'progress'));
  });
});

describe('remediation through the facade', () => {
  const LESSON = 'sql_json::select';
  const PREREQUISITE = 'sql_json::ddl';

  it('the second failure in a row returns the plan and sends remediation-triggered', async () => {
    const t = await createTestEngine({ library: 'sql-course' });
    const [target] = await idsOf(t.engine, LESSON);
    const first = await t.engine.practice.recordAttempt({
      requestId: 'f1',
      exerciseId: target!,
      grade: 1,
    });
    expect(first.remediation).toBeUndefined();
    t.events.length = 0;
    t.clock.advance(1_000);
    const second = await t.engine.practice.recordAttempt({
      requestId: 'f2',
      exerciseId: target!,
      grade: 2,
    });
    const prerequisiteIds = await idsOf(t.engine, PREREQUISITE);
    expect(second.remediation).toMatchObject({
      exerciseId: target,
      active: true,
      triggeredAt: second.at,
      steps: [
        {
          unitId: PREREQUISITE,
          source: 'lesson-dependency',
          exerciseIds: prerequisiteIds,
          done: false,
        },
      ],
    });
    expect(t.events.map(({ type }) => type)).toEqual([
      'progress',
      'remediation-triggered',
    ]);
    expect(t.events[1]).toEqual({
      type: 'remediation-triggered',
      exerciseId: target,
      steps: 1,
      at: second.at,
    });
    expect(await t.engine.remediation.getPlan({ exerciseId: target! })).toEqual(
      second.remediation,
    );
    // повтор попытки-триггера — duplicate без плана (порог пересечён не им)
    const replay = await t.engine.practice.recordAttempt({
      requestId: 'f2',
      exerciseId: target!,
      grade: 2,
    });
    expect(replay).toMatchObject({ duplicate: true });
    expect(replay.remediation).toBeUndefined();
  });

  it('a success on the exercise itself is not needed: the plan is resolved on its steps', async () => {
    const t = await createTestEngine({ library: 'sql-course' });
    const [target] = await idsOf(t.engine, LESSON);
    for (const [i, grade] of ([1, 1] as const).entries()) {
      t.clock.advance(1_000);
      await t.engine.practice.recordAttempt({
        requestId: `f${i}`,
        exerciseId: target!,
        grade,
      });
    }
    for (const exerciseId of await idsOf(t.engine, PREREQUISITE)) {
      t.clock.advance(1_000);
      await t.engine.practice.recordAttempt({
        requestId: `p-${exerciseId}`,
        exerciseId,
        grade: 4,
      });
    }
    expect(
      await t.engine.remediation.getPlan({ exerciseId: target! }),
    ).toMatchObject({
      active: false,
      steps: [{ done: true }],
    });
    await expect(
      t.engine.remediation.getPlan({ exerciseId: 'nope' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('getBatch puts remediation first and displaces the lowest priority new items', async () => {
    const t = await createTestEngine({ library: 'sql-course' });
    const [target] = await idsOf(t.engine, LESSON);
    for (const i of [1, 2]) {
      t.clock.advance(1_000);
      await t.engine.practice.recordAttempt({
        requestId: `f${i}`,
        exerciseId: target!,
        grade: 1,
      });
    }
    const windowIds = await idsOf(t.engine, 'sql_json::window');
    const library = t.ctx.library.require();
    const scheduled = [
      ...windowIds,
      ...(await idsOf(t.engine, 'sql_json::subquery')),
    ]
      .map((id) => library.getExercise(id)!)
      .slice(0, 6);
    vi.spyOn(t.ctx.scheduler, 'getExerciseBatch').mockReturnValue(scheduled);

    const batch = await t.engine.practice.getBatch();
    const pending = await idsOf(t.engine, PREREQUISITE);
    expect(batch.exercises.slice(0, 3).map(({ id }) => id)).toEqual(
      pending.slice(0, 3),
    );
    expect(batch.reasons.slice(0, 3)).toEqual([
      'remediation',
      'remediation',
      'remediation',
    ]);
    expect(batch.reasons.slice(3)).toEqual(['new', 'new', 'new']);
    expect(batch.exercises).toHaveLength(scheduled.length); // входят в размер батча
    expect(batch.exercises.slice(3).map(({ id }) => id)).toEqual(
      scheduled.slice(0, 3).map(({ id }) => id),
    );
  });

  it('an explicit filter keeps the batch inside its scope', async () => {
    const t = await createTestEngine({ library: 'sql-course' });
    const [target] = await idsOf(t.engine, LESSON);
    for (const i of [1, 2]) {
      t.clock.advance(1_000);
      await t.engine.practice.recordAttempt({
        requestId: `f${i}`,
        exerciseId: target!,
        grade: 1,
      });
    }
    const batch = await t.engine.practice.getBatch({
      filter: { UnitFilter: { LessonFilter: { lesson_ids: [LESSON] } } },
    });
    expect(batch.reasons).not.toContain('remediation');
    expect(batch.exercises.every(({ lessonId }) => lessonId === LESSON)).toBe(
      true,
    );
  });

  it('progress_reset of the failing exercise cancels the plan', async () => {
    const t = await createTestEngine({ library: 'sql-course' });
    const [target] = await idsOf(t.engine, LESSON);
    for (const i of [1, 2]) {
      t.clock.advance(1_000);
      await t.engine.practice.recordAttempt({
        requestId: `f${i}`,
        exerciseId: target!,
        grade: 1,
      });
    }
    t.clock.advance(1_000);
    await t.engine.practice.resetProgress({
      unitId: LESSON,
      requestId: 'reset',
    });
    expect(await t.engine.remediation.getPlan({ exerciseId: target! })).toEqual(
      {
        exerciseId: target,
        active: false,
        steps: [],
      },
    );
    const batch = await t.engine.practice.getBatch();
    expect(batch.reasons).not.toContain('remediation');
  });
});
