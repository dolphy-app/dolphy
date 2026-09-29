/** T-55: `RemediationTracker` — триггер, шаги, снятие, границы (сценарии в–ж). */
import type { Grade, SchedulerOptionsDto } from '@lms/engine-contract';
import {
  buildAttempt,
  buildLibrary,
  buildProgressReset,
  T0_MS,
} from '@lms/testkit';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEDULER_OPTIONS } from '../../src/scheduler/options.ts';
import { createTestProjections, toLibrary } from './helpers.ts';

const DAY_MS = 86_400_000;
const A = ['c::a::e0', 'c::a::e1', 'c::a::e2'] as const;
const B0 = 'c::b::e0';
const B1 = 'c::b::e1';
const K = ['c::k::e0', 'c::k::e1'] as const;

const source = buildLibrary({
  courses: [
    {
      id: 'c',
      lessons: [
        { id: 'a', exercises: ['e0', 'e1', 'e2'] },
        { id: 'b', dependencies: ['a'], exercises: ['e0', 'e1'] },
        { id: 'k', exercises: ['e0', 'e1'] },
      ],
    },
  ],
});
// b::e0 объявляет ключевой пререквизит — урок k
source.exercises = source.exercises.map((exercise) =>
  exercise.id === B0
    ? { ...exercise, engine: { keyPrerequisites: ['c::k'] } }
    : exercise,
);
const library = toLibrary(source);

const withRemediation = (
  remediation: SchedulerOptionsDto['remediation'],
): SchedulerOptionsDto => ({ ...DEFAULT_SCHEDULER_OPTIONS, remediation });

const setup = (options?: SchedulerOptionsDto) => {
  const target = createTestProjections(library, options);
  let seq = 0;
  const at = (days: number) => T0_MS + days * DAY_MS;
  const record = (exerciseId: string, grade: Grade, days: number) => {
    const entry = buildAttempt({ exerciseId, grade, seq: ++seq, at: at(days) });
    target.projections.apply(entry);
    return entry;
  };
  return { ...target, record, at, nextSeq: () => ++seq };
};

describe('RemediationTracker (T-55)', () => {
  it('a single failure, or a failure diluted by a success, does not trigger', () => {
    const { projections, record } = setup();
    record(B1, 1, 0);
    expect(projections.remediation.getPlan(B1)).toEqual({
      exerciseId: B1,
      active: false,
      steps: [],
    });
    record(B1, 4, 1);
    record(B1, 2, 2);
    expect(projections.remediation.getPlan(B1).active).toBe(false);
    expect(projections.remediation.activePlans()).toEqual([]);
  });

  it('two consecutive failures trigger; only the crossing attempt reports it', () => {
    const { projections, record } = setup();
    const first = record(B1, 2, 0);
    expect(projections.remediation.onAttempt(first)).toBeNull();
    const second = record(B1, 1, 1);
    const plan = projections.remediation.onAttempt(second);
    expect(plan).toMatchObject({ exerciseId: B1, active: true });
    const third = record(B1, 1, 2);
    expect(projections.remediation.onAttempt(third)).toBeNull(); // серия длиннее порога
    expect(projections.remediation.getPlan(B1).active).toBe(true);
  });

  it('steps follow the direct lesson dependencies; not started exercises come first by id', () => {
    const { projections, record } = setup();
    record(B1, 1, 0);
    record(B1, 1, 1);
    const plan = projections.remediation.getPlan(B1);
    expect(plan.triggeredAt).toBe(T0_MS + DAY_MS);
    expect(plan.steps).toEqual([
      {
        unitId: 'c::a',
        source: 'lesson-dependency',
        exerciseIds: [...A],
        done: false,
      },
    ]);
    expect(projections.remediation.pendingExerciseIds()).toEqual([...A]);
  });

  it('engine.keyPrerequisites take precedence over lesson dependencies', () => {
    const { projections, record } = setup();
    record(B0, 2, 0);
    record(B0, 2, 1);
    expect(projections.remediation.getPlan(B0).steps).toEqual([
      {
        unitId: 'c::k',
        source: 'key-prerequisite',
        exerciseIds: [...K],
        done: false,
      },
    ]);
  });

  it('within a step: lowest retrievability first, at most remediation.maxItems in total', () => {
    const { projections, record } = setup(
      withRemediation({ failThreshold: 2, maxItems: 2 }),
    );
    record(A[0], 5, -30); // забыто давно: R ниже
    record(A[1], 5, -1); // повторено вчера
    record(B1, 1, 0);
    record(B1, 1, 0.5);
    const [step] = projections.remediation.getPlan(B1).steps;
    // e2 не начато (R = 0), затем e0 (давняя попытка); e1 не влезает в лимит
    expect(step?.exerciseIds).toEqual([A[2], A[0]]);
  });

  it('the plan is fixed at trigger time: later attempts do not reorder steps', () => {
    const { projections, record } = setup(
      withRemediation({ failThreshold: 2, maxItems: 2 }),
    );
    record(B1, 1, 0);
    record(B1, 1, 0.5);
    const before = projections.remediation.getPlan(B1).steps[0]?.exerciseIds;
    record(A[0], 5, 10);
    expect(projections.remediation.getPlan(B1).steps[0]?.exerciseIds).toEqual(
      before,
    );
  });

  it('is resolved by a success on every step exercise after the trigger', () => {
    const { projections, record } = setup();
    record(A[0], 5, -1); // успех до триггера не считается
    record(B1, 1, 0);
    record(B1, 1, 1);
    record(A[0], 4, 2);
    record(A[1], 3, 2);
    expect(projections.remediation.getPlan(B1).active).toBe(true);
    expect(projections.remediation.pendingExerciseIds()).toEqual([A[2]]);
    record(A[2], 1, 3); // провал не снимает
    expect(projections.remediation.getPlan(B1).active).toBe(true);
    record(A[2], 3, 4);
    const plan = projections.remediation.getPlan(B1);
    expect(plan.active).toBe(false);
    expect(plan.steps.every(({ done }) => done)).toBe(true);
    expect(projections.remediation.activePlans()).toEqual([]);
  });

  it('a new failing streak after a success triggers again with a fresh plan', () => {
    const { projections, record } = setup();
    record(B1, 1, 0);
    record(B1, 1, 1);
    for (const id of A) record(id, 5, 2);
    expect(projections.remediation.getPlan(B1).active).toBe(false);
    record(B1, 4, 3);
    record(B1, 2, 4);
    const last = record(B1, 2, 5);
    expect(projections.remediation.onAttempt(last)).toMatchObject({
      active: true,
    });
    expect(projections.remediation.getPlan(B1).triggeredAt).toBe(
      T0_MS + 5 * DAY_MS,
    );
  });

  it('attempts covered by progress_reset do not count towards the trigger', () => {
    const { projections, record, at, nextSeq } = setup();
    record(B1, 1, 0);
    projections.apply(
      buildProgressReset({ unitId: 'c::b', seq: nextSeq(), at: at(1) }),
    );
    record(B1, 1, 2);
    expect(projections.remediation.getPlan(B1).active).toBe(false);
    record(B1, 1, 3);
    expect(projections.remediation.getPlan(B1).active).toBe(true);
  });

  it('failThreshold comes from the options', () => {
    const { projections, record } = setup(
      withRemediation({ failThreshold: 3, maxItems: 3 }),
    );
    record(B1, 1, 0);
    record(B1, 1, 1);
    expect(projections.remediation.getPlan(B1).active).toBe(false);
    record(B1, 1, 2);
    expect(projections.remediation.getPlan(B1).active).toBe(true);
  });

  it('active plans go newest trigger first; pending exercises are unique and bounded', () => {
    const { projections, record } = setup();
    record(B0, 1, 0);
    record(B0, 1, 1);
    record(B1, 1, 2);
    record(B1, 1, 3);
    expect(
      projections.remediation.activePlans().map(({ exerciseId }) => exerciseId),
    ).toEqual([B1, B0]);
    expect(projections.remediation.pendingExerciseIds()).toEqual([...A]);
    expect(projections.remediation.pendingExerciseIds(5)).toEqual([...A, ...K]);
    expect(projections.remediation.pendingExerciseIds(1)).toEqual([A[0]]);
  });

  it('a blacklisted unit is skipped when building steps', () => {
    const { projections, record, nextSeq, at } = setup();
    projections.apply({
      kind: 'unit_flag',
      id: 'flag-1',
      deviceId: 'device-a',
      seq: nextSeq(),
      at: at(-2),
      recordedAt: at(-2),
      unitId: A[0],
      flag: 'blacklist',
      op: 'set',
    });
    record(B1, 1, 0);
    record(B1, 1, 1);
    expect(projections.remediation.getPlan(B1).steps[0]?.exerciseIds).toEqual([
      A[1],
      A[2],
    ]);
  });
});
