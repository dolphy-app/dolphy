/**
 * Симуляция обучения (порт `spike/fire-plan/src/sim.ts`) поверх продукционных
 * `createMemoryIndex` + `createPlanner` + `collectDue`. Ученик-истина — тот же
 * (`truthHasCredit: true`, круговая модель) или второй индекс без неявного
 * кредита (`false`: неявного повтора в реальности нет).
 *
 * Политики: P0 — без кредита; P1 — кредит только в индексе памяти (план — по
 * наименьшей R); P2 — кредит и в индексе, и в планировщике (сжатие).
 * Проводка планировщика как в `PlanService`: кредит-модель — только при
 * `enabled`.
 */
import type { EpochMs, SchedulerOptionsDto } from '@spirula/engine-contract';
import { MS_PER_DAY } from '../../src/scoring/constants.ts';
import { createCreditModel } from '../../src/planning/credit-model.ts';
import { createMemoryIndex } from '../../src/planning/memory-index.ts';
import type { MemoryIndexProjection } from '../../src/planning/memory-index.ts';
import { createPlanner } from '../../src/planning/planner.ts';
import { createSeededRng } from '../../src/planning/seeded-random.ts';
import type { UnitId } from '@spirula/engine-contract';
import {
  CREDIT_OFF,
  CREDIT_ON,
  DEFAULT_GEN,
  PLANNER_OPTIONS,
  TARGET_RETENTION,
  attemptOf,
  createSpikeRng,
  frontierOf,
  genGraph,
  memoryModel,
  planStateOf,
  retrievabilityOf,
} from './helpers.ts';
import type { GenOptions, Regime } from './helpers.ts';

export type Policy = 'P0' | 'P1' | 'P2';

export interface SimParams {
  gen: GenOptions;
  regime: Regime;
  policy: Policy;
  budget: number;
  days: number;
  seed: number;
  /** Учитывать ли неявный кредит в реальной памяти ученика (круговая модель). */
  truthHasCredit: boolean;
  /** Вероятность успеха при первой встрече упражнения. */
  pNew: number;
  /** Переопределяет `implicitCredit.enabled`, заданный политикой. */
  implicitEnabled?: boolean;
}

export interface SimResult {
  donePerDay: number;
  reviewsPerDay: number;
  newPerDay: number;
  /** Среднее число просроченных (по истинной памяти) в начале дня, дни 30..конец. */
  backlogMean: number;
  backlogEnd: number;
  backlogSeries: number[];
  /** Доля начатых упражнений с истинной R ≥ 0.8 в конце. */
  shareR80: number;
  meanR: number;
  lessonsIntroduced: number;
  exercisesIntroduced: number;
  implicitPerAttempt: number;
  coversPerReviewItem: number;
  successRate: number;
  /** Порядок упражнений каждого дневного плана (для сравнения прогонов). */
  planSeries: UnitId[][];
}

export const SIM_T0: EpochMs =
  1_800_000_000_000 - (1_800_000_000_000 % MS_PER_DAY) + 9 * 3_600_000;

export const simParams = (over: Partial<SimParams>): SimParams => ({
  gen: DEFAULT_GEN,
  regime: 'trane',
  policy: 'P2',
  budget: 40,
  days: 90,
  seed: 1,
  truthHasCredit: true,
  pNew: 0.8,
  ...over,
});

const mean = (values: readonly number[]) =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

export const runSim = (params: SimParams): SimResult => {
  const { library, graph, mode } = genGraph(
    { ...params.gen, seed: params.seed },
    params.regime,
  );
  const enabled = params.implicitEnabled ?? params.policy !== 'P0';
  const creditOptions: Pick<SchedulerOptionsDto, 'implicitCredit'> = enabled
    ? CREDIT_ON
    : CREDIT_OFF;
  const makeIndex = (
    options: Pick<SchedulerOptionsDto, 'implicitCredit'>,
  ): MemoryIndexProjection => {
    const index = createMemoryIndex({
      memoryModel,
      ratingMap: 'runner',
      options: () => options,
      encompassMode: mode,
    });
    index.rebuild([], library);
    return index;
  };
  const system = makeIndex(creditOptions);
  const truthSeparate = enabled && !params.truthHasCredit;
  const truth = truthSeparate ? makeIndex(CREDIT_OFF) : system;
  const planner = createPlanner(
    graph,
    enabled && params.policy === 'P2'
      ? createCreditModel(graph, CREDIT_ON.implicitCredit)
      : null,
    PLANNER_OPTIONS,
  );
  const rng = createSpikeRng(params.seed * 7919 + 13);

  let seq = 0;
  let done = 0;
  let reviews = 0;
  let news = 0;
  let successes = 0;
  let coverSum = 0;
  const backlog: number[] = [];
  const planSeries: UnitId[][] = [];

  const dueCountTruth = (now: EpochMs) => {
    let count = 0;
    for (const id of truth.attemptedExerciseIds()) {
      if (retrievabilityOf(truth, id, now) <= TARGET_RETENTION) count++;
    }
    return count;
  };

  for (let day = 0; day < params.days; day++) {
    const now = SIM_T0 + day * MS_PER_DAY;
    backlog.push(dueCountTruth(now));
    const items = planner.planDay(planStateOf(graph, system, now), {
      maxItems: params.budget,
      rng: createSeededRng(params.seed * 1000 + day),
    });
    planSeries.push(items.map((item) => item.exerciseId));
    for (const [position, item] of items.entries()) {
      const at = now + position * 60_000;
      const known = truth.getMemory(item.exerciseId) !== null;
      const retrievability = known
        ? retrievabilityOf(truth, item.exerciseId, at)
        : params.pNew;
      const success = rng.next() < retrievability;
      const attempt = attemptOf(
        seq++,
        at,
        item.exerciseId,
        success ? 5 : 1,
        'sim',
      );
      system.apply(attempt, library);
      if (truthSeparate) truth.apply(attempt, library);
      done++;
      if (success) successes++;
      if (item.reason === 'review') {
        reviews++;
        coverSum += item.covers.length;
      } else {
        news++;
      }
    }
  }

  const end = SIM_T0 + params.days * MS_PER_DAY;
  let introduced = 0;
  let atLeast80 = 0;
  let sumR = 0;
  const lessons = new Set<UnitId>();
  for (const id of truth.attemptedExerciseIds()) {
    introduced++;
    lessons.add(
      graph.lessonIds[
        graph.exerciseLesson[graph.exerciseIndex.get(id) as number] as number
      ] as UnitId,
    );
    const retrievability = retrievabilityOf(truth, id, end);
    sumR += retrievability;
    if (retrievability >= 0.8) atLeast80++;
  }
  const tail = backlog.slice(Math.min(30, backlog.length - 1));
  return {
    donePerDay: done / params.days,
    reviewsPerDay: reviews / params.days,
    newPerDay: news / params.days,
    backlogMean: mean(tail),
    backlogEnd: dueCountTruth(end),
    backlogSeries: backlog,
    shareR80: introduced === 0 ? 0 : atLeast80 / introduced,
    meanR: introduced === 0 ? 0 : sumR / introduced,
    lessonsIntroduced: lessons.size,
    exercisesIntroduced: introduced,
    implicitPerAttempt:
      system.stats.attempts === 0
        ? 0
        : system.stats.implicitUpdates / system.stats.attempts,
    coversPerReviewItem: reviews === 0 ? 0 : coverSum / reviews,
    successRate: successes / Math.max(1, done),
    planSeries,
  };
};

export type SimNumericKey = Exclude<
  keyof SimResult,
  'backlogSeries' | 'planSeries'
>;

/** Среднее по seed каждой числовой метрики. */
export const meanOver = (
  results: readonly SimResult[],
  key: SimNumericKey,
): number => mean(results.map((result) => result[key]));

export { frontierOf };
