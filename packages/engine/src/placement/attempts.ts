import type { Grade, UnitId } from '@dolphy-app/engine-contract';
import { CLASS_KNOWN } from './diagnostic.ts';
import type { PlacementTopics } from './topics.ts';

/** Оценка синтетических попыток placement: 4 (значение ≥ 3.0 порога гейта). */
export const PLACEMENT_GRADE: Grade = 4;
/** Попыток на упражнение: гейту нужно среднее число попыток ≥ 1.8. */
export const PLACEMENT_ATTEMPTS_PER_EXERCISE = 2;
/** Расстояние между попытками одного упражнения, мс. */
export const PLACEMENT_SPACING_MS = 1_000;

export interface PlacementAttempt {
  readonly exerciseId: UnitId;
  /** Сдвиг от базового момента, мс. */
  readonly offsetMs: number;
}

/**
 * Попытки `known`-уроков: по `PLACEMENT_ATTEMPTS_PER_EXERCISE` на каждое
 * упражнение. Порядок — по кругам (сначала первая попытка каждого упражнения,
 * затем вторая), поэтому `seq` и время не убывают вместе; всё детерминировано.
 */
export const placementAttempts = (
  topics: PlacementTopics,
  classes: ArrayLike<number>,
): PlacementAttempt[] => {
  const attempts: PlacementAttempt[] = [];
  for (let round = 0; round < PLACEMENT_ATTEMPTS_PER_EXERCISE; round++) {
    topics.exercises.forEach((own, topic) => {
      if (classes[topic] !== CLASS_KNOWN) return;
      for (const exerciseId of own) {
        attempts.push({ exerciseId, offsetMs: round * PLACEMENT_SPACING_MS });
      }
    });
  }
  return attempts;
};
