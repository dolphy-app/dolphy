import type { UnitId } from '@spirula/engine-contract';
import type { UnitGraph } from '../domain/graph.ts';
import {
  REWARD_FACTOR,
  WEIGHT_FACTOR,
  stopPropagation,
} from '../scoring/reward-propagator.ts';
import type { Candidate } from './types.ts';

/** Порог оценки и веса категории «очень сильно покрыт»: удаляется из пачки. */
export const VERY_HIGHLY_SCORE = 4.5;
export const VERY_HIGHLY_WEIGHT = 10.0;
/** Порог оценки и веса категории «сильно покрыт»: уходит в окно mastered. */
export const HIGHLY_SCORE = 3.75;
export const HIGHLY_WEIGHT = 5.0;

export interface KnockoutResult {
  /** Пачка без очень сильно покрытых. */
  readonly candidates: readonly Candidate[];
  /** Подмножество `candidates`: остаются в пачке, но фильтр относит их к mastered. */
  readonly highlyEncompassed: readonly Candidate[];
}

/** Вес покрытия по id упражнения. */
export type WeightMap = ReadonlyMap<UnitId, number>;

interface WeightItem {
  readonly unitId: UnitId;
  readonly reward: number;
  readonly weight: number;
}

/**
 * Вес покрытия упражнений пачки (`compute_encompassing_map`): для каждого
 * урока и курса пачки обход графа охвата; вес ребра копится на достигнутом
 * юните, упражнение получает сумму весов своего урока и курса. `reverse`
 * обходит `getEncompassedBy` вместо `getEncompasses`. В Rust карты названы
 * `encompassed_by_map` (reverse = false) и `encompasses_map`; в TS —
 * `weightOnEncompassed` / `weightOnEncompassing` (см. `knockOutReviews`).
 */
export const computeEncompassingMap = (
  batch: readonly Candidate[],
  graph: Pick<
    UnitGraph,
    'getEncompasses' | 'getEncompassedBy' | 'getLessonCourse'
  >,
  reverse: boolean,
): Map<UnitId, number> => {
  const startUnits = new Set<UnitId>();
  for (const candidate of batch) {
    startUnits.add(candidate.lessonId);
    startUnits.add(candidate.courseId);
  }
  const unitWeights = new Map<UnitId, number>();

  for (const start of startUnits) {
    const stack: WeightItem[] = [{ unitId: start, reward: 1.0, weight: 1.0 }];
    const visited = new Set<UnitId>();
    for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
      if (visited.has(item.unitId)) continue;
      visited.add(item.unitId);
      const next = reverse
        ? graph.getEncompassedBy(item.unitId)
        : graph.getEncompasses(item.unitId);
      if (next === undefined) continue;
      for (const [nextId, edgeWeight] of next) {
        if (edgeWeight === 0.0 || stopPropagation(item.reward, item.weight)) {
          continue;
        }
        unitWeights.set(nextId, (unitWeights.get(nextId) ?? 0) + edgeWeight);
        const reward = item.reward * REWARD_FACTOR;
        const weight = edgeWeight * item.weight * WEIGHT_FACTOR;
        stack.push({ unitId: nextId, reward, weight });
        const courseId = graph.getLessonCourse(nextId);
        if (courseId !== undefined) {
          stack.push({ unitId: courseId, reward, weight });
        }
      }
    }
  }

  const exerciseWeights = new Map<UnitId, number>();
  for (const candidate of batch) {
    const lessonWeight = unitWeights.get(candidate.lessonId) ?? 0;
    const courseWeight = unitWeights.get(candidate.courseId) ?? 0;
    exerciseWeights.set(candidate.exerciseId, lessonWeight + courseWeight);
  }
  return exerciseWeights;
};

const isVeryHighlyEncompassed = (candidate: Candidate, weight: number) =>
  weight >= VERY_HIGHLY_WEIGHT && candidate.exerciseScore >= VERY_HIGHLY_SCORE;

/** Убирает очень сильно покрытые упражнения. */
export const removeVeryHighlyEncompassed = (
  candidates: readonly Candidate[],
  weights: WeightMap,
): Candidate[] =>
  candidates.filter(
    (candidate) =>
      !isVeryHighlyEncompassed(
        candidate,
        weights.get(candidate.exerciseId) ?? 0,
      ),
  );

/** Сильно покрытые упражнения (очень сильно покрытые исключаются). */
export const getHighlyEncompassed = (
  candidates: readonly Candidate[],
  weights: WeightMap,
): Candidate[] => {
  const highly: Candidate[] = [];
  for (const candidate of candidates) {
    const weight = weights.get(candidate.exerciseId);
    if (weight === undefined) continue;
    if (isVeryHighlyEncompassed(candidate, weight)) continue;
    if (weight >= HIGHLY_WEIGHT && candidate.exerciseScore >= HIGHLY_SCORE) {
      highly.push(candidate);
    }
  }
  return highly;
};

export interface ReviewKnocker {
  /** Проставляет веса покрытия (копии кандидатов) и отсеивает покрытые. */
  knockOutReviews(initialBatch: readonly Candidate[]): KnockoutResult;
}

/**
 * `ReviewKnocker` (`review_knocker.rs`): без состояния, читает граф текущей
 * библиотеки при каждом вызове. Вес считается по всей исходной пачке, а не по
 * итоговому батчу — известное ограничение Trane (improvement_plan.md:33-107),
 * перенесено как есть.
 */
export const createReviewKnocker = (
  graph: () => Pick<
    UnitGraph,
    'getEncompasses' | 'getEncompassedBy' | 'getLessonCourse'
  >,
): ReviewKnocker => {
  const knockOutReviews = (initialBatch: readonly Candidate[]) => {
    const unitGraph = graph();
    const weightOnEncompassed = computeEncompassingMap(
      initialBatch,
      unitGraph,
      false,
    );
    const weightOnEncompassing = computeEncompassingMap(
      initialBatch,
      unitGraph,
      true,
    );
    const weighted = initialBatch.map((candidate): Candidate => ({
      ...candidate,
      encompassesWeight: weightOnEncompassing.get(candidate.exerciseId) ?? 0,
      encompassedWeight: weightOnEncompassed.get(candidate.exerciseId) ?? 0,
    }));
    const candidates = removeVeryHighlyEncompassed(
      weighted,
      weightOnEncompassed,
    );
    const highlyEncompassed = getHighlyEncompassed(
      candidates,
      weightOnEncompassed,
    );
    return { candidates, highlyEncompassed };
  };

  return { knockOutReviews };
};
