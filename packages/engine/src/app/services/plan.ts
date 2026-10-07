import type {
  DayPlanDto,
  PlanItemDto,
  PlanRequest,
  PlanService,
  UnitId,
} from '@dolphy-app/engine-contract';
import type { Library } from '../../domain/library.ts';
import { collectDue } from '../../planning/due-set.ts';
import {
  type CreditModel,
  type CreditParams,
  createCreditModel,
} from '../../planning/credit-model.ts';
import { type PlanGraph, buildPlanGraph } from '../../planning/plan-graph.ts';
import { createPlanner } from '../../planning/planner.ts';
import { passesThreshold } from '../../scheduler/depth-first-scheduler.ts';
import { ScoringError } from '../../scoring/errors.ts';
import {
  createSeededRng,
  drawSeed,
  isUint32,
} from '../../planning/seeded-random.ts';
import { resolveCourseScope } from '../course-scope.ts';
import type { EngineContext } from '../context.ts';
import { EngineError } from '../errors.ts';
import { runBatchHook } from '../hooks.ts';

/** Граница размера плана — самый большой замеренный план (engine-ts-api.md §10). */
export const MAX_PLAN_ITEMS = 200;

const creditSignature = ({ lambda, minCredit, kappa }: CreditParams) =>
  `${lambda}:${minCredit}:${kappa}`;

/**
 * `plan.getDay` (F4, engine-ts.md §6a.2): функция состояния, `seed` и хука
 * `practice.batch` расширений (только они могут изменить результат).
 * Читает проекции, не меняет `SessionState` и `frequencyMap` (в отличие от
 * `getBatch`) и ничего не пишет в журнал. Граф охвата и кредит-модель
 * кэшируются по библиотеке и опциям.
 */
export const createPlanService = (ctx: EngineContext): PlanService => {
  const graphs = new WeakMap<Library, PlanGraph>();
  let credits: {
    graph: PlanGraph;
    signature: string;
    model: CreditModel;
  } | null = null;

  const graphOf = (library: Library) => {
    let graph = graphs.get(library);
    if (graph === undefined) {
      graph = buildPlanGraph(library, 'declared');
      graphs.set(library, graph);
    }
    return graph;
  };

  const creditOf = (graph: PlanGraph, params: CreditParams) => {
    const signature = creditSignature(params);
    if (
      credits === null ||
      credits.graph !== graph ||
      credits.signature !== signature
    ) {
      credits = { graph, signature, model: createCreditModel(graph, params) };
    }
    return credits.model;
  };

  const getDay = async ({
    maxItems,
    seed,
    courseIds,
  }: PlanRequest): Promise<DayPlanDto> => {
    if (
      !Number.isInteger(maxItems) ||
      maxItems < 1 ||
      maxItems > MAX_PLAN_ITEMS
    ) {
      throw new EngineError('INVALID_ARGUMENT', {
        details: { maxItems, min: 1, max: MAX_PLAN_ITEMS },
      });
    }
    if (seed !== undefined && !isUint32(seed)) {
      throw new EngineError('INVALID_ARGUMENT', { details: { seed } });
    }
    const library = ctx.library.require();
    const scope = resolveCourseScope(library, courseIds);
    const graph = graphOf(library);
    const { plan, implicitCredit, passingScore } = ctx.options.get();
    const usedSeed = seed ?? drawSeed(ctx.rng);
    const { flags, attempts, memory, remediation } = ctx.projections;

    // вне области курсов — то же, что blacklist: ни просроченных, ни новых,
    // ни ремедиации (планировщик проверяет `isExcluded` для всех троих)
    const isExcluded = (exerciseId: UnitId) => {
      const lessonId = library.graph.getExerciseLesson(exerciseId) ?? '';
      const courseId = library.graph.getLessonCourse(lessonId) ?? '';
      return (
        (scope !== null && !scope.hasLesson(lessonId)) ||
        flags.isBlacklisted(exerciseId) ||
        flags.isBlacklisted(lessonId) ||
        flags.isBlacklisted(courseId)
      );
    };

    // порог урока — как во фронтире и DFS Trane; вытесненный урок проходит
    const lessonPasses = (lessonId: UnitId) => {
      const { scorer } = ctx;
      if (
        scorer.isSuperseded(
          lessonId,
          scorer.getSupersedingRecursive(lessonId) ?? new Set(),
        )
      ) {
        return true;
      }
      let score: number | null = null;
      try {
        score = scorer.getUnitScore(lessonId);
      } catch (error) {
        if (!(error instanceof ScoringError)) throw error;
      }
      return passesThreshold(
        passingScore,
        score,
        scorer.getAvgTrials(lessonId),
      );
    };

    const now = ctx.clock.now();
    const due = collectDue(
      { memory, memoryModel: ctx.memoryModel, graph, isExcluded },
      now,
      plan.targetRetention,
    );
    const planner = createPlanner(
      graph,
      implicitCredit.enabled ? creditOf(graph, implicitCredit) : null,
      {
        minNewFraction: plan.minNewFraction,
        maxSameCourseRun: plan.maxSameCourseRun,
        minTagDistance: plan.minTagDistance,
        fillWithNew: true,
      },
    );
    const { items, interleaveOk } = planner.planDayDetailed(
      {
        due,
        hasAttempts: (exerciseId) => attempts.count(exerciseId) > 0,
        frontierLessons: ctx.getFrontier().map(({ lessonId }) => lessonId),
        lessonPasses,
        isExcluded,
        remediation: remediation.pendingExerciseIds(),
      },
      { maxItems, rng: createSeededRng(usedSeed) },
    );

    const planned = items.map(({ exerciseId, reason, covers }): PlanItemDto => {
      const withCovers =
        implicitCredit.enabled && covers.length > 0
          ? {
              covers: covers.map((cover) => ({
                exerciseId: cover.exerciseId,
                credit: cover.credit,
              })),
            }
          : {};
      return { exerciseId, reason, ...withCovers };
    });
    // хук может переставить, убрать и добавить; оставленные элементы сохраняют `covers`
    const hooked = await runBatchHook(ctx, 'plan', planned);
    const plannedById = new Map(planned.map((item) => [item.exerciseId, item]));

    return {
      items: hooked.map(({ exerciseId, reason }): PlanItemDto => ({
        ...plannedById.get(exerciseId),
        exerciseId,
        reason,
      })),
      interleaveOk,
      implicitCreditEnabled: implicitCredit.enabled,
      seed: usedSeed,
      generatedAt: now,
    };
  };

  return { getDay };
};
