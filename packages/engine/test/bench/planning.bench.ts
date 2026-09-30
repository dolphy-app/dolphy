/**
 * T-57 (engine-ts-testing.md §7.1), M6: `MemoryIndex.rebuild` на журнале 500k
 * (режимы `none`, `sparse`, `trane`) и инкрементальное применение, `planDay`
 * на 40 позиций из просроченных 500…5 000 и выбор пробы placement (V3,
 * N = 3 000 тем). Запуск: `pnpm -F @lms/engine bench`. Бенчмарки советуют, не
 * блокируют: числа печатаются, регресс более чем вдвое от базы документа —
 * `console.warn`; падают только ошибки корректности.
 *
 * Режим памяти = граф и `implicitCredit`: `none` — кредит выключен;
 * `sparse` — кредит на объявленных охватах (30 % зависимостей); `trane` —
 * кредит на охватах по графу зависимостей.
 */
import type { UnitId } from '@lms/engine-contract';
import { T0_MS } from '@lms/testkit';
import { describe, expect, it } from 'vitest';
import { createDiagnosticSession } from '../../src/placement/index.ts';
import { createCreditModel } from '../../src/planning/credit-model.ts';
import { createMemoryIndex } from '../../src/planning/memory-index.ts';
import { createPlanner } from '../../src/planning/planner.ts';
import type {
  PlanDueExercise,
  PlanItem,
  PlanState,
} from '../../src/planning/planner.ts';
import { createSeededRng } from '../../src/planning/seeded-random.ts';
import {
  CREDIT_OFF,
  CREDIT_ON,
  DEFAULT_GEN,
  PLANNER_OPTIONS,
  genGraph,
  memoryModel,
  shuffled,
} from '../planning/helpers.ts';
import type { GenOptions, Regime } from '../planning/helpers.ts';
import {
  layeredDag,
  mulberry32,
  noisyOracle,
  randomDownset,
} from '../placement/helpers.ts';
import {
  RUNS,
  report,
  summarize,
  timed,
  warnOnRegression,
} from './bench-stats.ts';
import {
  BENCH_EVENTS,
  BENCH_EXERCISES_PER_LESSON,
  BENCH_LESSONS,
  BENCH_SEED,
  generateJournal,
} from './journal-generator.ts';

const DAY_MS = 86_400_000;
const INCREMENTAL_BATCH = 20_000;
const PLAN_ITEMS = 40;
const PLAN_CALLS = 20;
const DUE_SIZES = [500, 1_000, 2_000, 5_000] as const;
const PLACEMENT_TOPICS = 3_000;
const PLACEMENT_SESSIONS = 20;
const PLACEMENT_BUDGET = 60;

/** Числа документа (M6, engine-ts-testing.md §7.1). */
const BASE = {
  rebuildMs: { none: 399, sparse: 1_125, trane: 17_578 },
  incrementalUs: { none: 0.53, sparse: 2.14, trane: 35.5 },
  planDayMs: {
    none: { min: 1.6, max: 2.1 },
    trane: { min: 8.3, max: 22.7 },
  },
  placementMs: 0.33,
} as const;

const GEN: GenOptions = {
  ...DEFAULT_GEN,
  lessons: BENCH_LESSONS,
  courseSize: BENCH_LESSONS / 10,
  exercisesPerLesson: BENCH_EXERCISES_PER_LESSON,
  seed: BENCH_SEED,
};

const REGIME_LIST = [
  'none',
  'sparse',
  'trane',
] as const satisfies readonly Regime[];

describe('T-57 планирование: MemoryIndex 500k, planDay, проба placement', () => {
  const exerciseIds = genGraph(GEN, 'none').graph.exerciseIds;
  const journal = generateJournal({ exerciseIds });

  it.each(REGIME_LIST)(
    'MemoryIndex.rebuild 500k и инкрементальное применение: режим %s',
    (regime) => {
      const { library, mode } = genGraph(GEN, regime);
      const credit = regime === 'none' ? CREDIT_OFF : CREDIT_ON;
      const index = createMemoryIndex({
        memoryModel,
        ratingMap: 'runner',
        options: () => credit,
        encompassMode: mode,
      });

      const rebuilds: number[] = [];
      for (let run = 0; run < RUNS; run++) {
        rebuilds.push(timed(() => index.rebuild(journal, library)));
        expect(index.stats.attempts).toBe(BENCH_EVENTS);
        expect(index.stats.replays).toBe(0);
        expect(index.stats.implicitUpdates > 0).toBe(regime !== 'none');
      }
      const rebuildStats = summarize(rebuilds);
      report(`rebuild ${BENCH_EVENTS}, режим ${regime}`, rebuildStats);
      warnOnRegression(
        `rebuild, режим ${regime}`,
        rebuildStats.median,
        BASE.rebuildMs[regime],
      );

      // новые попытки в конце журнала: путь без реплея, по 20k событий за запуск
      const microseconds: number[] = [];
      let expected = BENCH_EVENTS;
      for (let run = 0; run < RUNS; run++) {
        const batch = generateJournal({
          exerciseIds,
          count: INCREMENTAL_BATCH,
          seed: BENCH_SEED + run + 1,
          deviceIds: [`inc${run}-a`, `inc${run}-b`, `inc${run}-c`],
          days: 30,
          startAt: T0_MS + (800 + run * 30) * DAY_MS,
        });
        const ms = timed(() => {
          for (const attempt of batch) index.apply(attempt, library);
        });
        expected += INCREMENTAL_BATCH;
        expect(index.stats.attempts).toBe(expected);
        expect(index.stats.replays).toBe(0);
        microseconds.push((ms * 1_000) / INCREMENTAL_BATCH);
      }
      const incremental = summarize(microseconds);
      report(
        `инкрементально, режим ${regime}, по ${INCREMENTAL_BATCH} событий`,
        incremental,
        'мкс/событие',
      );
      warnOnRegression(
        `инкрементально, режим ${regime}`,
        incremental.median,
        BASE.incrementalUs[regime],
        'мкс/событие',
      );
    },
  );

  describe.each(['none', 'trane'] as const)(
    'planDay на 40 позиций, режим %s',
    (regime) => {
      const { graph } = genGraph(GEN, regime);
      const credit =
        regime === 'trane'
          ? createCreditModel(graph, CREDIT_ON.implicitCredit)
          : null;
      const planner = createPlanner(graph, credit, PLANNER_OPTIONS);

      /** `dueCount` просроченных упражнений — целые уроки; фронтир — из нетронутых уроков. */
      const stateOf = (dueCount: number, seed: number): PlanState => {
        const random = createSeededRng(seed);
        const order = shuffled(
          Array.from({ length: graph.lessonCount }, (_, lesson) => lesson),
          seed,
        );
        const dueLessons = dueCount / BENCH_EXERCISES_PER_LESSON;
        const due: PlanDueExercise[] = [];
        const attempted = new Set<UnitId>();
        for (const lesson of order.slice(0, dueLessons)) {
          for (const exercise of graph.lessonExercises[
            lesson
          ] as readonly number[]) {
            const exerciseId = graph.exerciseIds[exercise] as UnitId;
            due.push({
              exerciseId,
              retrievability: 0.3 + 0.6 * random.random(),
            });
            attempted.add(exerciseId);
          }
        }
        return {
          due,
          hasAttempts: (exerciseId) => attempted.has(exerciseId),
          frontierLessons: order
            .slice(dueLessons, dueLessons + 100)
            .map((lesson) => graph.lessonIds[lesson] as UnitId),
          lessonPasses: () => true,
          isExcluded: () => false,
          remediation: [],
        };
      };

      it.each(DUE_SIZES)('просроченных %i', (dueCount) => {
        const state = stateOf(dueCount, dueCount);
        expect(state.due.length).toBe(dueCount);
        const samples: number[] = [];
        for (let run = 0; run < RUNS * PLAN_CALLS; run++) {
          const rng = createSeededRng(run + 1);
          let plan: PlanItem[] = [];
          samples.push(
            timed(() => {
              plan = planner.planDay(state, { maxItems: PLAN_ITEMS, rng });
            }),
          );
          expect(plan.length).toBe(PLAN_ITEMS);
          expect(new Set(plan.map((item) => item.exerciseId)).size).toBe(
            PLAN_ITEMS,
          );
        }
        const stats = summarize(samples);
        report(
          `planDay 40 из ${dueCount} просроченных, режим ${regime}`,
          stats,
        );
        const base = BASE.planDayMs[regime];
        warnOnRegression(
          `planDay из ${dueCount}, режим ${regime}`,
          stats.median,
          base.max,
        );
      });
    },
  );

  it('выбор пробы placement (V3, N = 3 000 тем): время одного выбора', () => {
    const graph = layeredDag(PLACEMENT_TOPICS, 30, mulberry32(BENCH_SEED));
    expect(graph.size).toBe(PLACEMENT_TOPICS);
    const first: number[] = [];
    const every: number[] = [];
    // нулевой сеанс — прогрев JIT, в замер не входит
    for (let session = 0; session <= PLACEMENT_SESSIONS; session++) {
      const rng = mulberry32(BENCH_SEED + session);
      const truth = randomDownset(graph, rng, 20);
      const oracle = noisyOracle(truth, 0.05, 0.05, rng);
      const diagnostic = createDiagnosticSession(graph, {
        budget: PLACEMENT_BUDGET,
        seed: BENCH_SEED + session,
      });
      for (let probe = 0; ; probe++) {
        let topic: number | null = null;
        const ms = timed(() => {
          topic = diagnostic.nextProbe();
        });
        if (topic === null) break;
        if (session > 0) {
          every.push(ms);
          if (probe === 0) first.push(ms);
        }
        diagnostic.answer(topic, oracle(topic));
      }
      expect(diagnostic.probes.length).toBeGreaterThan(0);
    }
    const firstStats = summarize(first);
    const everyStats = summarize(every);
    report(
      'placement V3, N = 3000: первый выбор (все темы не решены)',
      firstStats,
    );
    report('placement V3, N = 3000: выбор пробы по всему сеансу', everyStats);
    warnOnRegression(
      'placement V3, выбор пробы',
      everyStats.median,
      BASE.placementMs,
    );
  });
});
