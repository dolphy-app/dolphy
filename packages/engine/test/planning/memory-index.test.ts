/**
 * T-52: `MemoryIndex` — `rebuild == incremental` побитово, семантика неявного
 * кредита, смена опций и библиотеки (порт `spike/fire-plan/test/
 * memory-index.test.ts`).
 */
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import type { SchedulerOptionsDto } from '@lms/engine-contract';
import type { AttemptRecord } from '../../src/app/context.ts';
import { MS_PER_DAY } from '../../src/scoring/constants.ts';
import { createFsrsScorer } from '../../src/scoring/fsrs-scorer.ts';
import { RATING_MAPS } from '../../src/scoring/rating-map.ts';
import { createCreditModel } from '../../src/planning/credit-model.ts';
import { createFractionalStepper } from '../../src/planning/fractional.ts';
import type { FireState, Rating } from '../../src/planning/fractional.ts';
import { createMemoryIndex } from '../../src/planning/memory-index.ts';
import type { MemoryIndexProjection } from '../../src/planning/memory-index.ts';
import { buildPlanGraph } from '../../src/planning/plan-graph.ts';
import type { EncompassMode } from '../../src/planning/plan-graph.ts';
import {
  CREDIT_OFF,
  CREDIT_ON,
  DEFAULT_GEN,
  REGIMES,
  T0,
  attemptOf,
  buildSpecLibrary,
  createSpikeRng,
  genGraph,
  genLog,
  memoryModel,
  shuffled,
  sortAttempts,
} from './helpers.ts';
import type { LessonSpec, Regime } from './helpers.ts';

type CreditOptions = Pick<SchedulerOptionsDto, 'implicitCredit'>;

const small = {
  ...DEFAULT_GEN,
  lessons: 24,
  courseSize: 8,
  exercisesPerLesson: 2,
};
const stepper = createFractionalStepper(memoryModel);
const at = (day: number) => T0 + day * MS_PER_DAY;

const indexOf = (
  options: () => CreditOptions,
  encompassMode: EncompassMode,
  ratingMap: 'runner' | 'anki' = 'runner',
): MemoryIndexProjection =>
  createMemoryIndex({ memoryModel, ratingMap, options, encompassMode });

const creditParams = (enabled: boolean, lambda = 0.9): CreditOptions => ({
  implicitCredit: { enabled, lambda, minCredit: 0.2, kappa: 1 },
});

describe('rebuild == incremental apply', () => {
  test.each(REGIMES)(
    'in order, shuffled arrival with duplicates and shuffled rebuild are bit-identical (%s)',
    (regime) => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 1e6 }),
          fc.integer({ min: 5, max: 120 }),
          (seed, count) => {
            const { library, mode } = genGraph({ ...small, seed }, regime);
            const graph = buildPlanGraph(library, mode);
            const log = genLog(
              graph.exerciseIds,
              count,
              40,
              0.8,
              createSpikeRng(seed),
            );
            const make = () => indexOf(() => CREDIT_ON, mode);
            const rebuilt = make();
            rebuilt.rebuild(log, library);

            const inOrder = make();
            for (const attempt of sortAttempts(log)) {
              inOrder.apply(attempt, library);
            }
            const arrival = make();
            const duplicates = log.slice(0, 5);
            for (const attempt of shuffled([...log, ...duplicates], seed)) {
              arrival.apply(attempt, library);
            }
            const reordered = make();
            reordered.rebuild(shuffled(log, seed + 1), library);
            const withDuplicates = make();
            withDuplicates.rebuild([...log, ...duplicates], library);

            const expected = rebuilt.snapshot();
            expect(inOrder.snapshot()).toEqual(expected);
            expect(arrival.snapshot()).toEqual(expected);
            expect(reordered.snapshot()).toEqual(expected);
            expect(withDuplicates.snapshot()).toEqual(expected);
            // дубликаты по id не считаются попытками
            expect(arrival.stats.attempts).toBe(log.length);
            expect(withDuplicates.stats.attempts).toBe(log.length);
            expect(
              expected.trials.reduce((sum, trials) => sum + trials, 0),
            ).toBe(log.length);
            // попытки в порядке журнала: поздних приходов нет, полный реплей —
            // только при подключении библиотеки
            expect(inOrder.stats.replays).toBeLessThanOrEqual(1);
          },
        ),
        { seed: 7, numRuns: 60 },
      );
    },
  );

  test('a late attempt is inserted in log order and replayed', () => {
    const { library, mode } = genGraph({ ...small, seed: 3 }, 'trane');
    const graph = buildPlanGraph(library, mode);
    const log = sortAttempts(
      genLog(graph.exerciseIds, 60, 30, 0.8, createSpikeRng(3)),
    );
    const late = log[10] as AttemptRecord;
    const rest = log.filter((attempt) => attempt !== late);
    const incremental = indexOf(() => CREDIT_ON, mode);
    for (const attempt of rest) incremental.apply(attempt, library);
    const replaysBefore = incremental.stats.replays;
    incremental.apply(late, library);
    expect(incremental.stats.replays).toBe(replaysBefore + 1);
    const rebuilt = indexOf(() => CREDIT_ON, mode);
    rebuilt.rebuild(log, library);
    expect(incremental.snapshot()).toEqual(rebuilt.snapshot());
  });

  test('journal key breaks ties: same instant is ordered by device, seq, id', () => {
    const { library, mode } = genGraph({ ...small, seed: 4 }, 'none');
    const exerciseId = library.getAllExerciseIds()[0] as string;
    const a = attemptOf(0, at(1), exerciseId, 5, 'a');
    const b = attemptOf(0, at(1), exerciseId, 1, 'b');
    const c = attemptOf(1, at(1), exerciseId, 4, 'b');
    const forward = indexOf(() => CREDIT_OFF, mode);
    forward.rebuild([a, b, c], library);
    const backward = indexOf(() => CREDIT_OFF, mode);
    backward.rebuild([c, b, a], library);
    expect(backward.snapshot()).toEqual(forward.snapshot());
    // порядок a → b → c: вручную через реальные обзоры
    let state = stepper.review(null, at(1), RATING_MAPS.runner[4] as Rating);
    state = stepper.review(state, at(1), RATING_MAPS.runner[0] as Rating);
    state = stepper.review(state, at(1), RATING_MAPS.runner[3] as Rating);
    expect(forward.getMemory(exerciseId)).toEqual({
      state: { stability: state.stability, difficulty: state.difficulty },
      lastAt: state.lastAt,
    });
  });
});

describe('implicit credit semantics on a 3-lesson chain', () => {
  const lesson = (id: string, deps: string[]): LessonSpec => ({
    id,
    courseId: 'course',
    deps,
    exercises: [`${id}::e0`, `${id}::e1`],
    tags: [],
  });
  const library = buildSpecLibrary([
    lesson('a', []),
    lesson('b', ['a']),
    lesson('c', ['b']),
  ]);
  const graph = buildPlanGraph(library, 'graph');
  const creditFromC = createCreditModel(graph, {
    lambda: 0.9,
    minCredit: 0.2,
    kappa: 1,
  }).of(graph.lessonIndex.get('c') as number);
  const weightOf = (lessonId: string) =>
    creditFromC.find((entry) => graph.lessonIds[entry.lesson] === lessonId)
      ?.weight as number;

  const fresh = (ratingMap: 'runner' | 'anki' = 'runner') => {
    const index = indexOf(() => CREDIT_ON, 'graph', ratingMap);
    index.rebuild([], library);
    return index;
  };
  const stateOf = (
    index: MemoryIndexProjection,
    id: string,
  ): FireState | null => {
    const memory = index.getMemory(id);
    return memory === null
      ? null
      : {
          stability: memory.state.stability,
          difficulty: memory.state.difficulty,
          lastAt: memory.lastAt,
        };
  };
  const stateMust = (index: MemoryIndexProjection, id: string): FireState => {
    const state = stateOf(index, id);
    if (state === null) throw new Error(`no state for ${id}`);
    return state;
  };

  test('failure and rating < 2 give no credit; missing state gets none', () => {
    const index = fresh();
    index.apply(attemptOf(0, at(0), 'a::e0', 5), library);
    const before = stateOf(index, 'a::e0');
    // grade 1 и 2 → Again (rating 1): кредита нет
    index.apply(attemptOf(1, at(10), 'c::e0', 1), library);
    index.apply(attemptOf(2, at(11), 'c::e1', 2), library);
    expect(stateOf(index, 'a::e0')).toEqual(before);
    expect(stateOf(index, 'b::e0')).toBeNull();
    expect(index.stats.implicitUpdates).toBe(0);
    // grade 3 → Hard (rating 2): кредит идёт
    index.apply(attemptOf(3, at(12), 'c::e0', 3), library);
    expect(stateOf(index, 'a::e0')).not.toEqual(before);
    expect(index.stats.implicitUpdates).toBe(1);
  });

  test('credited state equals the fractional step; D unchanged; only exercises with state', () => {
    const index = fresh();
    index.apply(attemptOf(0, at(0), 'a::e0', 5), library);
    index.apply(attemptOf(1, at(0), 'b::e1', 5), library);
    const beforeA = stateMust(index, 'a::e0');
    const beforeB = stateMust(index, 'b::e1');
    index.apply(attemptOf(2, at(20), 'c::e0', 5), library);

    const expectedA = stepper.fractional(beforeA, at(20), 3, weightOf('a'), {
      updateDifficulty: false,
    });
    expect(stateOf(index, 'a::e0')).toEqual(expectedA);
    expect(weightOf('a')).toBeCloseTo(0.81, 12);
    expect(weightOf('b')).toBeCloseTo(0.9, 12);
    const expectedB = stepper.fractional(beforeB, at(20), 3, weightOf('b'), {
      updateDifficulty: false,
    });
    expect(stateOf(index, 'b::e1')).toEqual(expectedB);
    // сложность не меняется кредитом
    expect(stateMust(index, 'a::e0').difficulty).toBe(beforeA.difficulty);
    expect(stateMust(index, 'b::e1').difficulty).toBe(beforeB.difficulty);
    // стабильность выросла
    expect(stateMust(index, 'a::e0').stability).toBeGreaterThan(
      beforeA.stability,
    );
    // упражнения без состояния состояния не получают; ни сиблинг источника, ни урок b
    expect(stateOf(index, 'a::e1')).toBeNull();
    expect(stateOf(index, 'b::e0')).toBeNull();
    expect(stateOf(index, 'c::e1')).toBeNull();
    // b::e1 (день 0) кредитует a::e0, попытка c::e0 — a::e0 и b::e1
    expect(index.stats.implicitUpdates).toBe(3);
  });

  test('trials grow only from real attempts; the real attempt is a plain review', () => {
    const index = fresh();
    index.apply(attemptOf(0, at(0), 'a::e0', 5), library);
    index.apply(attemptOf(1, at(10), 'c::e0', 1), library);
    index.apply(attemptOf(2, at(20), 'c::e0', 5), library);
    expect(index.trialsOf('a::e0')).toBe(1); // кредит не считается попыткой
    expect(index.trialsOf('c::e0')).toBe(2);
    expect(index.trialsOf('b::e0')).toBe(0);
    expect(index.trialsOf('unknown::x')).toBe(0);
    const before = stateMust(index, 'c::e0');
    index.apply(attemptOf(3, at(30), 'c::e0', 4), library);
    expect(stateOf(index, 'c::e0')).toEqual(
      stepper.review(before, at(30), RATING_MAPS.runner[3] as Rating),
    );
    expect(index.trialsOf('c::e0')).toBe(3);
  });

  test('implicit rating is capped at Good even when the real rating is Easy (anki map)', () => {
    const index = fresh('anki');
    index.apply(attemptOf(0, at(0), 'a::e0', 5), library);
    const before = stateOf(index, 'a::e0');
    index.apply(attemptOf(1, at(20), 'c::e0', 5), library); // anki: 5 → Easy (4)
    expect(stateOf(index, 'a::e0')).toEqual(
      stepper.fractional(before, at(20), 3, weightOf('a'), {
        updateDifficulty: false,
      }),
    );
  });

  test('credit is applied to states of the moment: a later first attempt is not credited retroactively', () => {
    const index = fresh();
    index.apply(attemptOf(0, at(0), 'c::e0', 5), library);
    index.apply(attemptOf(1, at(5), 'a::e0', 5), library);
    const rebuilt = fresh();
    rebuilt.rebuild(
      [attemptOf(1, at(5), 'a::e0', 5), attemptOf(0, at(0), 'c::e0', 5)],
      library,
    );
    expect(stateOf(index, 'a::e0')).toEqual(stateOf(rebuilt, 'a::e0'));
    expect(stateOf(index, 'a::e0')).toEqual(
      stepper.review(null, at(5), RATING_MAPS.runner[4] as Rating),
    );
  });
});

describe('credit switched off', () => {
  test.each(REGIMES)(
    'enabled=false touches nobody else: every exercise equals a replay of its own attempts (%s)',
    (regime) => {
      const { library, mode } = genGraph({ ...small, seed: 11 }, regime);
      const graph = buildPlanGraph(library, mode);
      const log = genLog(graph.exerciseIds, 200, 30, 0.9, createSpikeRng(3));
      const index = indexOf(() => CREDIT_OFF, mode);
      index.rebuild(log, library);
      expect(index.stats.implicitUpdates).toBe(0);
      const scorer = createFsrsScorer({ memory: memoryModel });
      const ordered = sortAttempts(log);
      let checked = 0;
      for (const exerciseId of graph.exerciseIds) {
        const own = ordered
          .filter((attempt) => attempt.exerciseId === exerciseId)
          .map((attempt) => ({ score: attempt.grade, timestamp: attempt.at }));
        const replayed = scorer.replay(own);
        expect(index.getMemory(exerciseId)).toEqual(replayed);
        expect(index.trialsOf(exerciseId)).toBe(own.length);
        if (replayed !== null) checked++;
      }
      expect(checked).toBeGreaterThan(20);
    },
  );

  test('the same log with credit on changes states (the check above is not vacuous)', () => {
    const { library, mode } = genGraph({ ...small, seed: 11 }, 'trane');
    const graph = buildPlanGraph(library, mode);
    const log = genLog(graph.exerciseIds, 200, 30, 0.9, createSpikeRng(3));
    const off = indexOf(() => CREDIT_OFF, mode);
    const on = indexOf(() => CREDIT_ON, mode);
    off.rebuild(log, library);
    on.rebuild(log, library);
    expect(on.stats.implicitUpdates).toBeGreaterThan(0);
    expect(on.snapshot().stability).not.toEqual(off.snapshot().stability);
    expect(on.snapshot().trials).toEqual(off.snapshot().trials);
  });
});

describe('difficulty in v1', () => {
  test.each(REGIMES)(
    'credit never changes D: an exercise with a single real attempt keeps its first-review D (%s)',
    (regime) => {
      const { library, mode } = genGraph({ ...small, seed: 5 }, regime);
      const graph = buildPlanGraph(library, mode);
      const log = genLog(graph.exerciseIds, 45, 30, 0.95, createSpikeRng(9));
      const index = indexOf(() => CREDIT_ON, mode);
      index.rebuild(log, library);
      if (regime !== 'none') {
        expect(index.stats.implicitUpdates).toBeGreaterThan(0);
      }
      let checked = 0;
      let changedStability = 0;
      for (const attempt of log) {
        if (index.trialsOf(attempt.exerciseId) !== 1) continue;
        const rating = RATING_MAPS.runner[attempt.grade - 1] as Rating;
        const first = stepper.review(null, attempt.at, rating);
        const memory = index.getMemory(attempt.exerciseId);
        expect(memory?.state.difficulty).toBe(first.difficulty);
        if (memory?.state.stability !== first.stability) changedStability++;
        checked++;
      }
      expect(checked).toBeGreaterThan(5);
      if (regime !== 'none') expect(changedStability).toBeGreaterThan(0);
    },
  );
});

describe('options and library changes', () => {
  const runChange = (
    regime: Regime,
    before: CreditOptions,
    after: CreditOptions,
  ) => {
    const { library, mode } = genGraph({ ...small, seed: 21 }, regime);
    const graph = buildPlanGraph(library, mode);
    const log = sortAttempts(
      genLog(graph.exerciseIds, 120, 30, 0.85, createSpikeRng(21)),
    );
    const head = log.slice(0, 100);
    const tail = log.slice(100);
    let current = before;
    const index = indexOf(() => current, mode);
    index.rebuild(head, library);
    current = after;
    for (const attempt of tail) index.apply(attempt, library);
    const reference = indexOf(() => after, mode);
    reference.rebuild(log, library);
    expect(index.snapshot()).toEqual(reference.snapshot());
    return { index, reference };
  };

  test.each(['trane', 'sparse'] as const)(
    'changing lambda / enabled at apply gives the same result as a fresh rebuild (%s)',
    (regime) => {
      runChange(regime, creditParams(true, 0.9), creditParams(true, 0.7));
      const off = runChange(regime, creditParams(true), creditParams(false));
      expect(off.index.stats.implicitUpdates).toBe(0);
      const on = runChange(regime, creditParams(false), creditParams(true));
      expect(on.index.stats.implicitUpdates).toBeGreaterThan(0);
    },
  );

  test('changing lambda changes the outcome', () => {
    const a = runChange(
      'trane',
      creditParams(true, 0.9),
      creditParams(true, 0.9),
    );
    const b = runChange(
      'trane',
      creditParams(true, 0.9),
      creditParams(true, 0.5),
    );
    expect(b.index.snapshot().stability).not.toEqual(
      a.index.snapshot().stability,
    );
  });

  test('unchanged options and library do not trigger a replay on in-order applies', () => {
    const { library, mode } = genGraph({ ...small, seed: 21 }, 'trane');
    const graph = buildPlanGraph(library, mode);
    const log = sortAttempts(
      genLog(graph.exerciseIds, 50, 30, 0.85, createSpikeRng(21)),
    );
    const index = indexOf(() => CREDIT_ON, mode);
    index.apply(log[0] as AttemptRecord, library);
    const replays = index.stats.replays;
    for (const attempt of log.slice(1)) index.apply(attempt, library);
    expect(index.stats.replays).toBe(replays);
  });

  test('switching the library in apply equals a fresh index rebuilt on the new library', () => {
    const first = genGraph({ ...small, seed: 31 }, 'none');
    const second = genGraph({ ...small, seed: 31 }, 'sparse');
    const graph = buildPlanGraph(first.library, 'declared');
    const log = sortAttempts(
      genLog(graph.exerciseIds, 100, 30, 0.9, createSpikeRng(31)),
    );
    const index = indexOf(() => CREDIT_ON, 'declared');
    index.rebuild(log.slice(0, 80), first.library);
    for (const attempt of log.slice(80)) index.apply(attempt, second.library);
    const reference = indexOf(() => CREDIT_ON, 'declared');
    reference.rebuild(log, second.library);
    expect(index.snapshot()).toEqual(reference.snapshot());
    // на 'none' кредита нет, на 'sparse' — есть: библиотеки различимы
    const onFirst = indexOf(() => CREDIT_ON, 'declared');
    onFirst.rebuild(log, first.library);
    expect(onFirst.stats.implicitUpdates).toBe(0);
    expect(reference.stats.implicitUpdates).toBeGreaterThan(0);
  });
});

describe('library boundaries', () => {
  test('an exercise outside the library is skipped', () => {
    const { library, mode } = genGraph({ ...small, seed: 2 }, 'trane');
    const index = indexOf(() => CREDIT_ON, mode);
    const known = library.getAllExerciseIds()[0] as string;
    index.rebuild([attemptOf(0, at(0), known, 5)], library);
    const snapshot = index.snapshot();
    index.apply(attemptOf(1, at(1), 'nope::l::e0', 5), library);
    expect(index.snapshot()).toEqual(snapshot);
    expect(index.trialsOf('nope::l::e0')).toBe(0);
    expect(index.getMemory('nope::l::e0')).toBeNull();
    expect(index.stats.attempts).toBe(1);
    const skipped = indexOf(() => CREDIT_ON, mode);
    skipped.rebuild(
      [attemptOf(0, at(0), 'nope::l::e0', 5), attemptOf(1, at(1), known, 5)],
      library,
    );
    expect(skipped.stats.attempts).toBe(1);
    expect([...skipped.attemptedExerciseIds()]).toEqual([known]);
  });

  test('without a library nothing is stored; clear() forgets everything', () => {
    const { library, mode } = genGraph({ ...small, seed: 2 }, 'trane');
    const known = library.getAllExerciseIds()[0] as string;
    const index = indexOf(() => CREDIT_ON, mode);
    index.rebuild([attemptOf(0, at(0), known, 5)], null);
    expect([...index.attemptedExerciseIds()]).toEqual([]);
    expect(index.snapshot().trials).toEqual([]);
    index.rebuild([attemptOf(0, at(0), known, 5)], library);
    expect([...index.attemptedExerciseIds()]).toEqual([known]);
    index.clear();
    expect([...index.attemptedExerciseIds()]).toEqual([]);
    expect(index.getMemory(known)).toBeNull();
    // после clear() индекс снова принимает попытки и результат прежний
    index.apply(attemptOf(0, at(0), known, 5), library);
    expect(index.trialsOf(known)).toBe(1);
  });
});

describe('agreement with the scorer replay', () => {
  test('real reviews of one exercise equal FsrsScorer.replay (runner map)', () => {
    const { library, mode } = genGraph({ ...small, seed: 6 }, 'trane');
    const exerciseId = library.getAllExerciseIds()[3] as string;
    const rng = createSpikeRng(17);
    let day = 0;
    const attempts: AttemptRecord[] = [];
    for (let seq = 0; seq < 14; seq++) {
      day += rng.int(4) === 0 ? 0 : 1 + rng.int(40);
      attempts.push(
        attemptOf(
          seq,
          at(day) + seq,
          exerciseId,
          (1 + rng.int(5)) as 1 | 2 | 3 | 4 | 5,
        ),
      );
    }
    const scorer = createFsrsScorer({
      memory: memoryModel,
      ratingMap: 'runner',
    });
    const index = indexOf(() => CREDIT_ON, mode, 'runner');
    index.rebuild(attempts, library);
    // кредит никому не достался (других состояний нет) — только реальные обзоры
    expect(index.stats.implicitUpdates).toBe(0);
    expect(index.getMemory(exerciseId)).toEqual(
      scorer.replay(
        attempts.map(({ grade, at: timestamp }) => ({
          score: grade,
          timestamp,
        })),
      ),
    );
    expect(index.trialsOf(exerciseId)).toBe(attempts.length);
  });
});
