/**
 * T-24, T-25, T-55 (б): проекции — функция множества записей. Инкрементальное
 * применение в любом порядке и с дублями даёт то же состояние, что полная
 * перестройка; «живость» попытки совпадает с брутфорс-определением.
 */
import type { Grade, UnitId } from '@lms/engine-contract';
import {
  buildAttempt,
  buildProgressReset,
  buildUnitFlag,
  generateLibrary,
} from '@lms/testkit';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../../src/domain/journal.ts';
import { compareEntries } from '../../src/sync/entry.ts';
import { compareEntryKeys } from '../../src/state/attempt-index.ts';
import { createTestProjections, snapshotOf, toLibrary } from './helpers.ts';

const SEED = 20260929;
const library = toLibrary(
  generateLibrary({
    courses: 2,
    lessonsPerCourse: 4,
    exercisesPerLesson: 3,
    seed: 7,
  }),
);
const exerciseIds = library.getAllExerciseIds();
const allUnits = [...library.graph.unitIds()].sort();

interface Draft {
  device: number;
  kind: 'attempt' | 'flag' | 'reset';
  exercise: number;
  unit: number;
  grade: Grade;
  flag: 'blacklist' | 'review';
  op: 'set' | 'unset';
  atStep: number;
}

const draftArb: fc.Arbitrary<Draft> = fc.record({
  device: fc.integer({ min: 0, max: 2 }),
  kind: fc.oneof(
    { weight: 12, arbitrary: fc.constant('attempt' as const) },
    { weight: 2, arbitrary: fc.constant('flag' as const) },
    { weight: 1, arbitrary: fc.constant('reset' as const) },
  ),
  exercise: fc.integer({ min: 0, max: exerciseIds.length - 1 }),
  unit: fc.integer({ min: 0, max: allUnits.length - 1 }),
  grade: fc.constantFrom<Grade>(1, 2, 3, 4, 5),
  flag: fc.constantFrom('blacklist' as const, 'review' as const),
  op: fc.constantFrom('set' as const, 'unset' as const),
  // равные `at` на разных устройствах: порядок решают `deviceId` и `seq`
  atStep: fc.integer({ min: 0, max: 3 }),
});

/** Записи одной «вселенной»: seq по устройствам без пропусков, `at` не убывает по устройству. */
const universeOf = (drafts: readonly Draft[]): LogEntry[] => {
  const seqs = [0, 0, 0];
  const ats = [0, 0, 0];
  return drafts.map((draft) => {
    const seq = ++seqs[draft.device]!;
    const at = (ats[draft.device] =
      ats[draft.device]! + draft.atStep * 3_600_000);
    const base = {
      deviceId: `device-${draft.device}`,
      seq,
      at: 1_800_000_000_000 + at,
    };
    if (draft.kind === 'attempt') {
      return buildAttempt({
        ...base,
        exerciseId: exerciseIds[draft.exercise]!,
        grade: draft.grade,
      });
    }
    if (draft.kind === 'flag') {
      return buildUnitFlag({
        ...base,
        unitId: allUnits[draft.unit]!,
        flag: draft.flag,
        op: draft.op,
      });
    }
    return buildProgressReset({ ...base, unitId: allUnits[draft.unit]! });
  });
};

const rebuilt = (entries: readonly LogEntry[]) => {
  const target = createTestProjections(library);
  const sorted = [...entries].sort(compareEntries);
  for (const entry of sorted) target.projections.apply(entry);
  return target;
};

describe('projections: incremental == rebuild (T-24, T-55 б)', () => {
  it('any arrival order with duplicates gives the rebuilt state', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(draftArb, { minLength: 1, maxLength: 40 }),
        fc.integer(),
        async (drafts, shuffleSeed) => {
          const entries = universeOf(drafts);
          const order = fc.sample(
            fc.shuffledSubarray(entries, { minLength: entries.length }),
            { seed: shuffleSeed, numRuns: 1 },
          )[0]!;
          const duplicates = order.filter(
            (_, i) => (i + shuffleSeed) % 3 === 0,
          );
          const incremental = createTestProjections(library);
          for (const entry of [...order, ...duplicates]) {
            incremental.projections.apply(entry);
          }
          const target = createTestProjections(library);
          await target.projections.rebuildFrom(
            (async function* () {
              yield* [...entries].sort(compareEntries);
            })(),
          );
          expect(snapshotOf(incremental)).toBe(snapshotOf(target));
        },
      ),
      { seed: SEED, numRuns: 200 },
    );
  });

  it('chronological arrival keeps derived projections fresh; reset marks them stale', () => {
    const target = createTestProjections(library);
    const { projections } = target;
    const [first, second] = exerciseIds as [UnitId, UnitId];
    projections.apply(buildAttempt({ exerciseId: first, seq: 1, at: 1_000 }));
    projections.apply(buildAttempt({ exerciseId: second, seq: 2, at: 2_000 }));
    projections.apply(
      buildUnitFlag({ unitId: first, flag: 'review', seq: 3, at: 3_000 }),
    );
    expect(projections.isStale()).toBe(false);
    projections.apply(buildProgressReset({ unitId: first, seq: 4, at: 4_000 }));
    expect(projections.isStale()).toBe(true);
    expect(projections.attempts.count(first)).toBe(0);
    expect(projections.attempts.count(second)).toBe(1);
  });

  it('an older record than the applied ones marks derived projections stale', () => {
    const { projections } = createTestProjections(library);
    const [exerciseId] = exerciseIds as [UnitId];
    projections.apply(buildAttempt({ exerciseId, seq: 2, at: 2_000 }));
    projections.apply(buildAttempt({ exerciseId, seq: 1, at: 1_000 }));
    expect(projections.isStale()).toBe(true);
    expect(projections.attempts.count(exerciseId)).toBe(2);
  });
});

describe('progress_reset: a brute-force oracle (T-25)', () => {
  it('an attempt is alive iff no reset of its exercise, lesson or course has a key >= its key', () => {
    fc.assert(
      fc.property(
        fc.array(draftArb, { minLength: 1, maxLength: 60 }),
        (drafts) => {
          const entries = universeOf(drafts);
          const { projections } = rebuilt(entries);
          const resets = entries.filter((e) => e.kind === 'progress_reset');
          for (const exerciseId of exerciseIds) {
            const lessonId = library.graph.getExerciseLesson(exerciseId)!;
            const courseId = library.graph.getLessonCourse(lessonId)!;
            const ancestors = new Set([exerciseId, lessonId, courseId]);
            const alive = entries
              .filter(
                (e) => e.kind === 'attempt' && e.exerciseId === exerciseId,
              )
              .filter(
                (attempt) =>
                  !resets.some(
                    (reset) =>
                      reset.kind === 'progress_reset' &&
                      ancestors.has(reset.unitId) &&
                      compareEntryKeys(reset, attempt) >= 0,
                  ),
              )
              .sort((a, b) => compareEntryKeys(b, a))
              .map(({ id }) => id);
            expect(
              projections.attempts.getRecords(exerciseId).map((r) => r.id),
            ).toEqual(alive);
            expect(projections.attempts.count(exerciseId)).toBe(alive.length);
          }
        },
      ),
      { seed: SEED, numRuns: 300 },
    );
  });
});
