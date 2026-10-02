/**
 * События обучения для расширений (спека extension-state, R7): `attempt.closed`
 * ровно на записанную попытку, `session.started` при создании id сессии,
 * `session.finished` по `practice.finishSession`.
 */
import type { LogEntryDto } from '@dolphy-app/engine-contract';
import { buildLibrary, createFakeExerciseTypes } from '@dolphy-app/testkit';
import type { RawVerdict } from '../../src/ports/index.ts';
import { describe, expect, it } from 'vitest';
import { createTestEngine } from '../helpers/engine.ts';
import type { TestEngineOptions } from '../helpers/engine.ts';

const VERIFIABLE = 'sql_json::aggregate::q1';
const PASSED: RawVerdict = { outcome: 'passed', durationMs: 1 };
const FAILED: RawVerdict = { outcome: 'failed', reason: 'x', durationMs: 1 };

const sqlTypes = (...script: RawVerdict[]) =>
  createFakeExerciseTypes({ types: { 'dolphy.sql': { script } } });

const sqlEngine = (script: RawVerdict[], options: TestEngineOptions = {}) =>
  createTestEngine({
    library: 'sql-course',
    exerciseTypes: sqlTypes(...script),
    ...options,
  });

const plain = () =>
  createTestEngine({
    library: buildLibrary({
      courses: [{ id: 'c', lessons: [{ id: 'l', exercises: 2 }] }],
    }),
  });

describe('attempt.closed', () => {
  it('self-assessed recordAttempt: one event with ids, grade, outcome, source and at — nothing else', async () => {
    const t = await plain();
    const result = await t.engine.practice.recordAttempt({
      requestId: 'r1',
      exerciseId: 'c::l::e0',
      grade: 4,
    });
    expect(t.learning).toEqual([
      {
        name: 'attempt.closed',
        payload: {
          exerciseId: 'c::l::e0',
          courseId: 'c',
          lessonId: 'c::l',
          grade: 4,
          outcome: 'self-assessed',
          source: 'self',
          at: result.at,
        },
      },
    ]);
  });

  it('a repeated requestId records nothing and emits nothing', async () => {
    const t = await plain();
    const request = {
      requestId: 'r1',
      exerciseId: 'c::l::e0',
      grade: 4 as const,
    };
    await t.engine.practice.recordAttempt(request);
    const again = await t.engine.practice.recordAttempt(request);
    expect(again.duplicate).toBe(true);
    expect(t.learning).toHaveLength(1);
  });

  it('a rejected request emits nothing', async () => {
    const t = await plain();
    await expect(
      t.engine.practice.recordAttempt({
        requestId: 'r1',
        exerciseId: 'nope',
        grade: 4,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(t.learning).toEqual([]);
  });

  it('imported and synchronised entries are not announced, local ones still are', async () => {
    const t = await createTestEngine();
    const exerciseId = 'embedded::raw_course::lesson::exercise';
    const foreign: LogEntryDto = {
      id: 'foreign-1',
      deviceId: 'device-x',
      seq: 1,
      at: 1_800_000_000_000,
      recordedAt: 1_800_000_000_000,
      kind: 'attempt',
      exerciseId,
      grade: 5,
      source: 'self',
    };
    const imported = await t.engine.sync.import([foreign]);
    expect(imported.inserted).toBe(1);
    expect(t.learning).toEqual([]);
    await t.engine.practice.recordAttempt({
      requestId: 'local-1',
      exerciseId,
      grade: 3,
    });
    expect(t.learning.map(({ name }) => name)).toEqual(['attempt.closed']);
  });

  it.each([
    ['pass@1', [PASSED], {}, 'passed', 'runner'],
    ['failed then passed', [FAILED, PASSED], {}, 'passed', 'runner'],
    ['failed, grade by the learner', [FAILED], { grade: 2 }, 'failed', 'self'],
    [
      'gave up after a failure',
      [FAILED],
      { outcome: 'gave-up' },
      'gave-up',
      'runner',
    ],
    ['gave up at once', [], { outcome: 'gave-up' }, 'gave-up', 'runner'],
  ] as const)(
    'completeAttempt %s → outcome %s, source %s',
    async (_name, script, complete, outcome, source) => {
      const t = await sqlEngine([...script]);
      const { attemptId } = await t.engine.practice.beginAttempt({
        exerciseId: VERIFIABLE,
      });
      for (let i = 0; i < script.length; i++) {
        await t.engine.practice.submitAnswer({ attemptId, answer: 'select 1' });
      }
      expect(t.learning).toEqual([]); // проверка ответа ничего не пишет и не объявляет
      const result = await t.engine.practice.completeAttempt({
        attemptId,
        ...complete,
      });
      expect(t.learning).toHaveLength(1);
      expect(t.learning[0]).toMatchObject({
        name: 'attempt.closed',
        payload: {
          exerciseId: VERIFIABLE,
          courseId: 'sql_json',
          lessonId: 'sql_json::aggregate',
          grade: result.grade,
          outcome,
          source,
          at: result.at,
        },
      });
    },
  );

  it('completeAttempt without verification (self-assessed exercise) is self-assessed', async () => {
    const t = await plain();
    const { attemptId } = await t.engine.practice.beginAttempt({
      exerciseId: 'c::l::e1',
    });
    await t.engine.practice.completeAttempt({ attemptId, grade: 3 });
    expect(t.learning[0]).toMatchObject({
      payload: { outcome: 'self-assessed', source: 'self', grade: 3 },
    });
  });

  it('a repeated completeAttempt does not announce the attempt again', async () => {
    const t = await sqlEngine([PASSED]);
    const { attemptId } = await t.engine.practice.beginAttempt({
      exerciseId: VERIFIABLE,
    });
    await t.engine.practice.submitAnswer({ attemptId, answer: 'select 1' });
    await t.engine.practice.completeAttempt({ attemptId });
    await t.engine.practice.completeAttempt({ attemptId });
    expect(t.learning).toHaveLength(1);
  });

  it('never carries the answer, the spec or the feedback', async () => {
    const t = await sqlEngine([FAILED, PASSED]);
    const { attemptId } = await t.engine.practice.beginAttempt({
      exerciseId: VERIFIABLE,
    });
    for (let i = 0; i < 2; i++) {
      await t.engine.practice.submitAnswer({
        attemptId,
        answer: 'secret answer text',
      });
    }
    await t.engine.practice.completeAttempt({ attemptId });
    const text = JSON.stringify(t.learning);
    expect(text).not.toContain('secret answer text');
    expect(Object.keys(t.learning[0]?.payload ?? {}).sort()).toEqual([
      'at',
      'courseId',
      'exerciseId',
      'grade',
      'lessonId',
      'outcome',
      'source',
    ]);
  });
});

describe('sessions', () => {
  it('startSession announces the id it returns; getBatch creates the id lazily once', async () => {
    const t = await plain();
    const started = await t.engine.practice.startSession();
    expect(t.learning).toEqual([
      {
        name: 'session.started',
        payload: { sessionId: started.sessionId, at: started.startedAt },
      },
    ]);
    const batch = await t.engine.practice.getBatch();
    await t.engine.practice.getBatch();
    expect(batch.sessionId).toBe(started.sessionId);
    expect(t.learning).toHaveLength(1);
  });

  it('the first getBatch announces the session it creates, later ones do not', async () => {
    const t = await plain();
    const first = await t.engine.practice.getBatch();
    const second = await t.engine.practice.getBatch();
    expect(second.sessionId).toBe(first.sessionId);
    expect(t.learning).toEqual([
      {
        name: 'session.started',
        payload: { sessionId: first.sessionId, at: expect.any(Number) },
      },
    ]);
  });

  it('a failed getBatch leaves no half-created session: the id is created and announced by the next success', async () => {
    const t = await plain();
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
    expect(t.learning).toEqual([]);
    const batch = await t.engine.practice.getBatch();
    expect(t.learning).toMatchObject([
      { name: 'session.started', payload: { sessionId: batch.sessionId } },
    ]);
  });

  it('finishSession announces once per id; repeat and unknown ids are no-ops', async () => {
    const t = await plain();
    const { sessionId } = await t.engine.practice.startSession();
    t.clock.advance(5_000);
    expect(await t.engine.practice.finishSession({ sessionId })).toEqual({
      emitted: true,
    });
    expect(await t.engine.practice.finishSession({ sessionId })).toEqual({
      emitted: false,
    });
    expect(
      await t.engine.practice.finishSession({ sessionId: 'never-issued' }),
    ).toEqual({ emitted: false });
    expect(t.learning.map(({ name }) => name)).toEqual([
      'session.started',
      'session.finished',
    ]);
    expect(t.learning[1]).toEqual({
      name: 'session.finished',
      payload: { sessionId, at: t.clock.now() },
    });
  });

  it('finishSession rejects an empty id', async () => {
    const t = await plain();
    await expect(
      t.engine.practice.finishSession({ sessionId: '' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('after finishSession the next getBatch starts a new session with a new id', async () => {
    const t = await plain();
    const first = await t.engine.practice.getBatch();
    await t.engine.practice.finishSession({ sessionId: first.sessionId });
    const second = await t.engine.practice.getBatch();
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(t.learning.map(({ name }) => name)).toEqual([
      'session.started',
      'session.finished',
      'session.started',
    ]);
  });

  it('finishing an older session after a restart of the session does not touch the current one', async () => {
    const t = await plain();
    const old = await t.engine.practice.startSession();
    const current = await t.engine.practice.startSession();
    await t.engine.practice.finishSession({ sessionId: old.sessionId });
    const batch = await t.engine.practice.getBatch();
    expect(batch.sessionId).toBe(current.sessionId);
  });
});

describe('listeners', () => {
  it('a failing learning listener changes neither the journal nor the command result', async () => {
    const t = await plain();
    t.engine.onLearningEvent(() => {
      throw new Error('extension host is down');
    });
    t.engine.onLearningEvent(() => Promise.reject(new Error('and async')));
    const result = await t.engine.practice.recordAttempt({
      requestId: 'r1',
      exerciseId: 'c::l::e0',
      grade: 5,
    });
    expect(result).toMatchObject({ duplicate: false, grade: 5 });
    expect(t.eventStore.entryCount()).toBe(1);
    expect(t.learning).toHaveLength(1);
  });
});
