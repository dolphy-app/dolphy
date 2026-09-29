/**
 * Попытка с проверкой: `beginAttempt` → `submitAnswer`* → `completeAttempt`
 * (T-10, T-41 в части движка, `GradePolicy` passAtN, лимиты реестра попыток).
 */
import type { SubmissionDto, VerdictDto } from '@lms/engine-contract';
import { MAX_SQL_CHARS } from '@lms/engine-contract';
import { buildLibrary } from '@lms/testkit';
import { describe, expect, it, vi } from 'vitest';
import type { LogEntry } from '../../src/domain/journal.ts';
import type {
  RawVerdict,
  VerifyRequest,
  Verifier,
} from '../../src/ports/index.ts';
import { createTestEngine } from '../helpers/engine.ts';
import type { TestEngineOptions } from '../helpers/engine.ts';

const VERIFIABLE = 'sql_json::aggregate::q1';
const SUBMISSION: SubmissionDto = { kind: 'sql', sql: 'select 1' };

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

interface FakeVerifier extends Verifier {
  readonly requests: VerifyRequest[];
  closed: boolean;
}

/** Раннер, отдающий вердикты по сценарию; каждый вызов сохраняется. */
const createFakeVerifier = (
  ...script: (RawVerdict | Promise<RawVerdict>)[]
): FakeVerifier => {
  const requests: VerifyRequest[] = [];
  const queue = [...script];
  const verifier: FakeVerifier = {
    runner: 'sql',
    requests,
    closed: false,
    check: async (request) => {
      requests.push(request);
      const next = queue.shift();
      if (next === undefined) throw new Error('script is exhausted');
      return next;
    },
    close: async () => {
      verifier.closed = true;
    },
  };
  return verifier;
};

const setup = (verifier: Verifier | null, options: TestEngineOptions = {}) =>
  createTestEngine({
    library: 'sql-course',
    verifiers: verifier === null ? [] : [verifier],
    ...options,
  });

const journalOf = async (readAll: () => AsyncIterable<LogEntry>) => {
  const entries: LogEntry[] = [];
  for await (const entry of readAll()) entries.push(entry);
  return entries;
};

describe('beginAttempt', () => {
  it('reports verifiable exercises and returns the exercise DTO', async () => {
    const t = await setup(createFakeVerifier());
    const attempt = await t.engine.practice.beginAttempt({
      exerciseId: VERIFIABLE,
    });
    expect(attempt).toMatchObject({
      verifiable: true,
      startedAt: t.clock.now(),
      exercise: { id: VERIFIABLE, verification: { runner: 'sql' } },
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
        submission: SUBMISSION,
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
    const t = await setup(createFakeVerifier());
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
    const t = await setup(createFakeVerifier());
    const attempt = await t.engine.practice.beginAttempt({
      exerciseId: VERIFIABLE,
    });
    t.clock.advance(24 * 3_600_000 + 1);
    await expect(
      t.engine.practice.submitAnswer({
        attemptId: attempt.attemptId,
        submission: SUBMISSION,
      }),
    ).rejects.toMatchObject({ code: 'ATTEMPT_NOT_FOUND' });
  });
});

describe('completeAttempt derives the grade from verdicts (passAtN)', () => {
  const finish = async (
    script: RawVerdict[],
    complete: { grade?: 1 | 2 | 3 | 4 | 5; outcome?: 'gave-up' } = {},
  ) => {
    const verifier = createFakeVerifier(...script);
    const t = await setup(verifier);
    const { attemptId } = await t.engine.practice.beginAttempt({
      exerciseId: VERIFIABLE,
    });
    const verdicts: VerdictDto[] = [];
    for (let i = 0; i < script.length; i++) {
      verdicts.push(
        await t.engine.practice.submitAnswer({
          attemptId,
          submission: SUBMISSION,
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
        submission: SUBMISSION,
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
    const t = await setup(createFakeVerifier());
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

describe('submitAnswer', () => {
  it('passes the exercise, submission, timeout and authorMode to the runner', async () => {
    const verifier = createFakeVerifier(PASSED);
    const t = await setup(verifier, { config: { authorMode: true } });
    const { attemptId } = await t.engine.practice.beginAttempt({
      exerciseId: VERIFIABLE,
    });
    await t.engine.practice.submitAnswer({ attemptId, submission: SUBMISSION });
    expect(verifier.requests).toHaveLength(1);
    expect(verifier.requests[0]).toMatchObject({
      exercise: { id: VERIFIABLE },
      submission: SUBMISSION,
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
    const hidden = await setup(createFakeVerifier(detailed));
    const shown = await setup(createFakeVerifier(detailed), {
      config: { authorMode: true },
    });
    const submit = async (t: Awaited<ReturnType<typeof setup>>) => {
      const { attemptId } = await t.engine.practice.beginAttempt({
        exerciseId: VERIFIABLE,
      });
      return t.engine.practice.submitAnswer({
        attemptId,
        submission: SUBMISSION,
      });
    };
    expect(await submit(hidden)).not.toHaveProperty('detail');
    expect(await submit(shown)).toMatchObject({ detail: 'expected: 1' });
  });

  it('SQL longer than MAX_SQL_CHARS fails with sqlite_limit without calling the runner (T-41)', async () => {
    const verifier = createFakeVerifier();
    const t = await setup(verifier);
    const { attemptId } = await t.engine.practice.beginAttempt({
      exerciseId: VERIFIABLE,
    });
    const verdict = await t.engine.practice.submitAnswer({
      attemptId,
      submission: { kind: 'sql', sql: 'x'.repeat(MAX_SQL_CHARS + 1) },
    });
    expect(verdict).toMatchObject({
      outcome: 'failed',
      reason: 'sqlite_limit',
      attemptsUsed: 1,
    });
    expect(verifier.requests).toEqual([]);
  });

  it('without a runner for the exercise: VERIFIER_UNAVAILABLE, not retryable', async () => {
    const t = await setup(null);
    const { attemptId } = await t.engine.practice.beginAttempt({
      exerciseId: VERIFIABLE,
    });
    await expect(
      t.engine.practice.submitAnswer({ attemptId, submission: SUBMISSION }),
    ).rejects.toMatchObject({
      code: 'VERIFIER_UNAVAILABLE',
      retryable: false,
      details: { cause: 'no-runner', runner: 'sql' },
    });
  });

  it('does not queue behind other commands, and one verdict at a time per attempt', async () => {
    let release: (verdict: RawVerdict) => void = () => {};
    const pending = new Promise<RawVerdict>((resolve) => {
      release = resolve;
    });
    const t = await setup(createFakeVerifier(pending));
    const { attemptId } = await t.engine.practice.beginAttempt({
      exerciseId: VERIFIABLE,
    });
    const submitting = t.engine.practice.submitAnswer({
      attemptId,
      submission: SUBMISSION,
    });
    // остальные команды не ждут вердикта
    const other = await t.engine.practice.recordAttempt({
      requestId: 'r',
      exerciseId: 'sql_json::ddl::q1',
      grade: 3,
    });
    expect(other.duplicate).toBe(false);
    await expect(
      t.engine.practice.submitAnswer({ attemptId, submission: SUBMISSION }),
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

  it('a runner that never answers ends with VERIFIER_TIMEOUT at the call deadline', async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<RawVerdict>(() => {});
      const t = await setup(createFakeVerifier(never, PASSED));
      const { attemptId } = await t.engine.practice.beginAttempt({
        exerciseId: VERIFIABLE,
      });
      const submitting = t.engine.practice.submitAnswer({
        attemptId,
        submission: SUBMISSION,
      });
      const outcome = expect(submitting).rejects.toMatchObject({
        code: 'VERIFIER_TIMEOUT',
        retryable: true,
      });
      await vi.advanceTimersByTimeAsync(2_000 + 5_000 + 1);
      await outcome;
      // критическая секция освобождена, попытка жива: повтор разрешён
      await expect(
        t.engine.practice.submitAnswer({ attemptId, submission: SUBMISSION }),
      ).resolves.toMatchObject({ outcome: 'passed', attemptsUsed: 1 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('close', () => {
  it('rejects new calls, closes runners and the store, and is idempotent', async () => {
    const verifier = createFakeVerifier();
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
