/**
 * Попытка с проверкой: `beginAttempt` → `submitAnswer`* → `completeAttempt`
 * (T-10, T-41 в части движка, `GradePolicy` passAtN, лимиты реестра попыток).
 */
import type { VerdictDto } from '@spirula/engine-contract';
import { MAX_ANSWER_CHARS } from '@spirula/engine-contract';
import {
  buildLibrary,
  createFakeExerciseTypes,
  createFakeGradePolicies,
} from '@spirula/testkit';
import type { FakeExerciseTypes } from '@spirula/testkit';
import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../../src/domain/journal.ts';
import type { RawVerdict } from '../../src/ports/index.ts';
import { ExerciseTypeError } from '../../src/ports/exercise-types.ts';
import { GradePolicyError } from '../../src/ports/grade-policies.ts';
import { createTestEngine } from '../helpers/engine.ts';
import type { TestEngineOptions } from '../helpers/engine.ts';

const VERIFIABLE = 'sql_json::aggregate::q1';
const ANSWER = 'select 1';

const PASSED: RawVerdict = { outcome: 'passed', durationMs: 3 };
const FAILED: RawVerdict = {
  outcome: 'failed',
  reason: 'mismatch',
  durationMs: 3,
};
const ERROR: RawVerdict = {
  outcome: 'error',
  reason: 'timeout',
  durationMs: 2000,
};

/** Вид `spirula.sql`, отдающий вердикты по сценарию; каждый вызов `grade` сохраняется. */
const createFakeSqlTypes = (
  ...script: (RawVerdict | Promise<RawVerdict>)[]
): FakeExerciseTypes =>
  createFakeExerciseTypes({ types: { 'spirula.sql': { script } } });

const setup = (
  types: FakeExerciseTypes | null,
  options: TestEngineOptions = {},
) =>
  createTestEngine({
    library: 'sql-course',
    exerciseTypes: types ?? createFakeExerciseTypes(),
    ...options,
  });

const journalOf = async (readAll: () => AsyncIterable<LogEntry>) => {
  const entries: LogEntry[] = [];
  for await (const entry of readAll()) entries.push(entry);
  return entries;
};

describe('beginAttempt', () => {
  it('reports verifiable exercises and returns the exercise DTO', async () => {
    const t = await setup(createFakeSqlTypes());
    const attempt = await t.engine.practice.beginAttempt({
      exerciseId: VERIFIABLE,
    });
    expect(attempt).toMatchObject({
      verifiable: true,
      startedAt: t.clock.now(),
      exercise: {
        id: VERIFIABLE,
        task: { type: 'spirula.sql', element: 'fake-spirula-sql' },
      },
      view: {},
    });
    expect(attempt.attemptId).toBeTruthy();
    await expect(
      t.engine.practice.beginAttempt({ exerciseId: 'nope' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('non-verifiable exercises accept only self-assessment', async () => {
    const t = await createTestEngine({
      library: buildLibrary({
        courses: [{ id: 'c', lessons: [{ id: 'l', exercises: 1 }] }],
      }),
    });
    const attempt = await t.engine.practice.beginAttempt({
      exerciseId: 'c::l::e0',
    });
    expect(attempt.verifiable).toBe(false);
    await expect(
      t.engine.practice.submitAnswer({
        attemptId: attempt.attemptId,
        answer: ANSWER,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      t.engine.practice.completeAttempt({ attemptId: attempt.attemptId }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const result = await t.engine.practice.completeAttempt({
      attemptId: attempt.attemptId,
      grade: 4,
    });
    expect(result).toMatchObject({ grade: 4, duplicate: false });
    const [entry] = await journalOf(() => t.eventStore.readAll());
    expect(entry).toMatchObject({
      kind: 'attempt',
      source: 'self',
      id: attempt.attemptId,
    });
  });

  it('keeps at most 100 open attempts: the oldest is evicted', async () => {
    const t = await setup(createFakeSqlTypes());
    const first = await t.engine.practice.beginAttempt({
      exerciseId: VERIFIABLE,
    });
    for (let i = 0; i < 100; i++) {
      await t.engine.practice.beginAttempt({ exerciseId: VERIFIABLE });
    }
    await expect(
      t.engine.practice.completeAttempt({
        attemptId: first.attemptId,
        grade: 3,
      }),
    ).rejects.toMatchObject({ code: 'ATTEMPT_NOT_FOUND' });
  });

  it('forgets an attempt after 24 hours', async () => {
    const t = await setup(createFakeSqlTypes());
    const attempt = await t.engine.practice.beginAttempt({
      exerciseId: VERIFIABLE,
    });
    t.clock.advance(24 * 3_600_000 + 1);
    await expect(
      t.engine.practice.submitAnswer({
        attemptId: attempt.attemptId,
        answer: ANSWER,
      }),
    ).rejects.toMatchObject({ code: 'ATTEMPT_NOT_FOUND' });
  });
});

describe('completeAttempt derives the grade from verdicts (passAtN)', () => {
  const finish = async (
    script: RawVerdict[],
    complete: { grade?: 1 | 2 | 3 | 4 | 5; outcome?: 'gave-up' } = {},
  ) => {
    const verifier = createFakeSqlTypes(...script);
    const t = await setup(verifier);
    const { attemptId } = await t.engine.practice.beginAttempt({
      exerciseId: VERIFIABLE,
    });
    const verdicts: VerdictDto[] = [];
    for (let i = 0; i < script.length; i++) {
      verdicts.push(
        await t.engine.practice.submitAnswer({
          attemptId,
          answer: ANSWER,
        }),
      );
    }
    return {
      t,
      attemptId,
      verdicts,
      verifier,
      complete: () =>
        t.engine.practice.completeAttempt({ attemptId, ...complete }),
    };
  };

  it.each([
    ['pass@1 → 5', [PASSED], 5],
    ['pass@2 → 4', [FAILED, PASSED], 4],
    ['pass@3 → 3', [FAILED, FAILED, PASSED], 3],
    ['pass@5 → 3', [FAILED, FAILED, FAILED, FAILED, PASSED], 3],
    ['errors do not count: error, pass → 5', [ERROR, PASSED], 5],
    [
      'errors do not count: failed, error, pass → 4',
      [FAILED, ERROR, PASSED],
      4,
    ],
  ] as const)('%s', async (_name, script, grade) => {
    const run = await finish([...script]);
    const result = await run.complete();
    expect(result.grade).toBe(grade);
    const [entry] = await journalOf(() => run.t.eventStore.readAll());
    expect(entry).toMatchObject({ source: 'runner', grade, id: run.attemptId });
  });

  it('numbers attempts only over passed/failed verdicts', async () => {
    const { verdicts } = await finish([FAILED, ERROR, FAILED, PASSED]);
    expect(
      verdicts.map(({ outcome, attemptsUsed }) => [outcome, attemptsUsed]),
    ).toEqual([
      ['failed', 1],
      ['error', 1],
      ['failed', 2],
      ['passed', 3],
    ]);
    expect(
      verdicts.every(({ attemptId }) => attemptId === verdicts[0]?.attemptId),
    ).toBe(true);
  });

  it('submitAnswer writes nothing to the journal, whatever the outcome (T-41)', async () => {
    const run = await finish([FAILED, ERROR, PASSED]);
    expect(run.t.eventStore.entryCount()).toBe(0);
    expect(run.t.events).toEqual([]);
  });

  it('gave-up gives 1 without any verdict', async () => {
    const run = await finish([], { outcome: 'gave-up' });
    expect((await run.complete()).grade).toBe(1);
  });

  it('only error verdicts need a self-assessed grade or gave-up', async () => {
    const run = await finish([ERROR]);
    await expect(run.complete()).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    expect(run.t.eventStore.entryCount()).toBe(0);
    const retry = await run.t.engine.practice.completeAttempt({
      attemptId: run.attemptId,
      grade: 3,
    });
    expect(retry.grade).toBe(3);
    const [entry] = await journalOf(() => run.t.eventStore.readAll());
    expect(entry).toMatchObject({ source: 'self' }); // оценка не из вердиктов
  });

  it('failed verdicts without a pass need a grade too; the verdict grade wins over the passed grade', async () => {
    const failedOnly = await finish([FAILED, FAILED]);
    await expect(failedOnly.complete()).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    const passed = await finish([PASSED], { grade: 1 });
    expect((await passed.complete()).grade).toBe(5);
  });

  it('is idempotent by attemptId: repeat returns the same result with duplicate', async () => {
    const run = await finish([PASSED]);
    const first = await run.complete();
    const second = await run.t.engine.practice.completeAttempt({
      attemptId: run.attemptId,
      grade: 1,
    });
    expect(second).toEqual({ ...first, duplicate: true });
    expect(run.t.eventStore.entryCount()).toBe(1);
    await expect(
      run.t.engine.practice.submitAnswer({
        attemptId: run.attemptId,
        answer: ANSWER,
      }),
    ).rejects.toMatchObject({ code: 'ATTEMPT_CLOSED' });
  });

  it('a completed attempt sends progress and the result reflects the new scores', async () => {
    const run = await finish([PASSED]);
    const result = await run.complete();
    expect(result.affected[0]).toMatchObject({ unitId: VERIFIABLE });
    expect(run.t.events.map(({ type }) => type)).toEqual(['progress']);
  });

  it('rejects unknown attempts and out-of-range grades', async () => {
    const t = await setup(createFakeSqlTypes());
    await expect(
      t.engine.practice.completeAttempt({ attemptId: 'nope', grade: 3 }),
    ).rejects.toMatchObject({ code: 'ATTEMPT_NOT_FOUND' });
    const { attemptId } = await t.engine.practice.beginAttempt({
      exerciseId: VERIFIABLE,
    });
    await expect(
      t.engine.practice.completeAttempt({ attemptId, grade: 9 as 5 }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('completeAttempt with a selected grade policy', () => {
  const run = async (
    policies: Parameters<typeof createFakeGradePolicies>[0],
    selected: string | null,
    script: RawVerdict[] = [FAILED, PASSED],
    complete: { grade?: 1 | 2 | 3 | 4 | 5; outcome?: 'gave-up' } = {},
  ) => {
    const gradePolicies = createFakeGradePolicies(policies);
    const t = await setup(createFakeSqlTypes(...script), { gradePolicies });
    if (selected !== null) {
      await t.engine.settings.setLearning({ gradePolicy: selected });
    }
    const { attemptId } = await t.engine.practice.beginAttempt({
      exerciseId: VERIFIABLE,
    });
    for (let i = 0; i < script.length; i++) {
      await t.engine.practice.submitAnswer({ attemptId, answer: ANSWER });
    }
    const complete_ = () =>
      t.engine.practice.completeAttempt({ attemptId, ...complete });
    return { t, gradePolicies, complete: complete_ };
  };

  it('the selected extension policy decides the grade and gets the verdicts', async () => {
    const { complete, gradePolicies, t } = await run(
      { 'acme.generous': { handler: () => 5 } },
      'acme.generous',
    );
    const result = await complete();
    expect(result.grade).toBe(5);
    expect(gradePolicies.calls).toHaveLength(1);
    expect(gradePolicies.calls[0]).toMatchObject({
      id: 'acme.generous',
      input: { gaveUp: false },
    });
    expect(
      gradePolicies.calls[0]?.input.verdicts.map((v) => v.outcome),
    ).toEqual(['failed', 'passed']);
    const [entry] = await journalOf(() => t.eventStore.readAll());
    expect(entry).toMatchObject({ source: 'runner', grade: 5 });
  });

  it('switching back to passAtN takes effect on the next completion without asking the extension', async () => {
    const { complete, gradePolicies, t } = await run(
      { 'acme.generous': { handler: () => 5 } },
      'acme.generous',
    );
    await t.engine.settings.setLearning({ gradePolicy: 'passAtN' });
    expect((await complete()).grade).toBe(4);
    expect(gradePolicies.calls).toEqual([]);
  });

  it('the default is passAtN and never asks the extension', async () => {
    const { complete, gradePolicies } = await run(
      { 'acme.generous': { handler: () => 5 } },
      null,
    );
    expect((await complete()).grade).toBe(4);
    expect(gradePolicies.calls).toEqual([]);
  });

  it.each([
    [
      'throws a host error',
      () => {
        throw new GradePolicyError('host-down', 'acme.p', 'down');
      },
    ],
    [
      'throws anything',
      () => {
        throw new Error('kaboom');
      },
    ],
    ['returns 9', () => 9],
    ['returns a string', () => 'five'],
  ])(
    'a policy that %s → passAtN grade, the attempt is still recorded, a warning is logged',
    async (_name, handler) => {
      const { complete, t } = await run({ 'acme.p': { handler } }, 'acme.p');
      const result = await complete();
      expect(result.grade).toBe(4);
      const [entry] = await journalOf(() => t.eventStore.readAll());
      expect(entry).toMatchObject({ source: 'runner', grade: 4 });
      expect(
        t.logs.filter(
          ({ level, fields }) =>
            level === 'warn' &&
            (fields as { policyId?: string }).policyId === 'acme.p',
        ),
      ).toHaveLength(1);
    },
  );

  it('a saved policy that no extension provides any more falls back to passAtN', async () => {
    const { complete } = await run({}, 'gone.policy');
    expect((await complete()).grade).toBe(4);
  });

  it('gave-up goes through the selected policy too', async () => {
    const { complete, gradePolicies } = await run(
      { 'acme.p': { handler: ({ gaveUp }) => (gaveUp ? 2 : 5) } },
      'acme.p',
      [],
      { outcome: 'gave-up' },
    );
    expect((await complete()).grade).toBe(2);
    expect(gradePolicies.calls[0]?.input.gaveUp).toBe(true);
  });

  it('a policy answering null falls back to the self-assessed grade', async () => {
    const { complete } = await run(
      { 'acme.p': { handler: () => null } },
      'acme.p',
      [FAILED],
      { grade: 3 },
    );
    const result = await complete();
    expect(result.grade).toBe(3);
  });
});

describe('exercise type availability', () => {
  it('unknown type: beginAttempt throws EXERCISE_TYPE_UNAVAILABLE, not retryable', async () => {
    const t = await setup(null);
    await expect(
      t.engine.practice.beginAttempt({ exerciseId: VERIFIABLE }),
    ).rejects.toMatchObject({
      code: 'EXERCISE_TYPE_UNAVAILABLE',
      retryable: false,
      details: { cause: 'unknown-type', type: 'spirula.sql' },
    });
  });

  it('project failure with host-down is retryable and opens no attempt', async () => {
    const types = createFakeSqlTypes();
    types.project = async ({ type }) => {
      throw new ExerciseTypeError('host-down', type, 'host is down');
    };
    const t = await setup(types);
    await expect(
      t.engine.practice.beginAttempt({ exerciseId: VERIFIABLE }),
    ).rejects.toMatchObject({
      code: 'EXERCISE_TYPE_UNAVAILABLE',
      retryable: true,
      details: { cause: 'host-down' },
    });
  });

  it('returns the view produced by project()', async () => {
    const types = createFakeExerciseTypes({
      types: { 'spirula.sql': { project: { hint: 'h' } } },
    });
    const t = await setup(types);
    const attempt = await t.engine.practice.beginAttempt({
      exerciseId: VERIFIABLE,
    });
    expect(attempt.view).toEqual({ hint: 'h' });
  });
});

describe('submitAnswer', () => {
  it('passes the type, spec, answer, timeout and authorMode to the exercise type', async () => {
    const verifier = createFakeSqlTypes(PASSED);
    const t = await setup(verifier, { config: { authorMode: true } });
    const { attemptId } = await t.engine.practice.beginAttempt({
      exerciseId: VERIFIABLE,
    });
    await t.engine.practice.submitAnswer({ attemptId, answer: ANSWER });
    expect(verifier.requests).toHaveLength(1);
    expect(verifier.requests[0]).toMatchObject({
      type: 'spirula.sql',
      exerciseId: VERIFIABLE,
      spec: expect.objectContaining({ fixture: expect.any(String) }),
      answer: ANSWER,
      timeoutMs: 2000,
      authorMode: true,
    });
  });

  it('strips the expected rows unless authorMode is on', async () => {
    const detailed: RawVerdict = {
      ...FAILED,
      outcome: 'failed',
      reason: 'mismatch',
      detail: 'expected: 1',
    };
    const hidden = await setup(createFakeSqlTypes(detailed));
    const shown = await setup(createFakeSqlTypes(detailed), {
      config: { authorMode: true },
    });
    const submit = async (t: Awaited<ReturnType<typeof setup>>) => {
      const { attemptId } = await t.engine.practice.beginAttempt({
        exerciseId: VERIFIABLE,
      });
      return t.engine.practice.submitAnswer({
        attemptId,
        answer: ANSWER,
      });
    };
    expect(await submit(hidden)).not.toHaveProperty('detail');
    expect(await submit(shown)).toMatchObject({ detail: 'expected: 1' });
  });

  it('an answer longer than MAX_ANSWER_CHARS is rejected without calling the exercise type (T-41)', async () => {
    const verifier = createFakeSqlTypes();
    const t = await setup(verifier);
    const { attemptId } = await t.engine.practice.beginAttempt({
      exerciseId: VERIFIABLE,
    });
    await expect(
      t.engine.practice.submitAnswer({
        attemptId,
        answer: 'x'.repeat(MAX_ANSWER_CHARS),
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { reason: 'answer-too-large' },
    });
    expect(verifier.requests).toEqual([]);
  });

  it('an answer that is not JSON is rejected', async () => {
    const t = await setup(createFakeSqlTypes());
    const { attemptId } = await t.engine.practice.beginAttempt({
      exerciseId: VERIFIABLE,
    });
    await expect(
      t.engine.practice.submitAnswer({ attemptId, answer: undefined }),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { reason: 'answer-not-json' },
    });
  });

  it('answer schema violations are INVALID_ARGUMENT, spend no attempt and skip grade', async () => {
    const types = createFakeExerciseTypes({
      types: {
        'spirula.sql': {
          answerErrors: ['/ must be array'],
          script: [PASSED],
        },
      },
    });
    const t = await setup(types);
    const { attemptId } = await t.engine.practice.beginAttempt({
      exerciseId: VERIFIABLE,
    });
    await expect(
      t.engine.practice.submitAnswer({ attemptId, answer: ANSWER }),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { reason: 'answer', issues: ['/ must be array'] },
    });
    expect(types.requests).toEqual([]);
  });

  it('does not queue behind other commands, and one verdict at a time per attempt', async () => {
    let release: (verdict: RawVerdict) => void = () => {};
    const pending = new Promise<RawVerdict>((resolve) => {
      release = resolve;
    });
    const t = await setup(createFakeSqlTypes(pending));
    const { attemptId } = await t.engine.practice.beginAttempt({
      exerciseId: VERIFIABLE,
    });
    const submitting = t.engine.practice.submitAnswer({
      attemptId,
      answer: ANSWER,
    });
    // остальные команды не ждут вердикта
    const other = await t.engine.practice.recordAttempt({
      requestId: 'r',
      exerciseId: 'sql_json::ddl::q1',
      grade: 3,
    });
    expect(other.duplicate).toBe(false);
    await expect(
      t.engine.practice.submitAnswer({ attemptId, answer: ANSWER }),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { reason: 'busy' },
    });
    await expect(
      t.engine.practice.completeAttempt({ attemptId, grade: 3 }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    release(PASSED);
    expect(await submitting).toMatchObject({ outcome: 'passed' });
  });
});

describe('close', () => {
  it('rejects new calls, closes runners and the store, and is idempotent', async () => {
    const verifier = createFakeSqlTypes();
    const t = await setup(verifier);
    await t.engine.close();
    expect(verifier.closed).toBe(true);
    await expect(t.engine.practice.getBatch()).rejects.toMatchObject({
      code: 'ENGINE_CLOSED',
      retryable: true,
    });
    await expect(t.engine.close()).resolves.toBeUndefined();
  });
});
