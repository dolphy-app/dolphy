import type { Grade, UnitId } from '@spirula-app/engine-contract';
import {
  type RelearnPile,
  type RelearnPileDeps,
  createRelearnPile,
} from './relearn-pile.ts';

/** Оценки 3–5 — успех, 1–2 — провал (`update_success_rate`, data.rs:402). */
const PASSING_GRADE_MIN = 3;

export interface TrialCounts {
  readonly success: number;
  readonly failed: number;
}

/**
 * Эфемерное состояние занятия (engine-ts.md §5.2): карта показов, пул
 * повторов и счётчики успехов. Живёт до перезапуска движка, как в Rust;
 * `reset()` вызывает `startSession()`.
 */
export interface SessionState {
  readonly relearnPile: RelearnPile;
  frequencyOf(exerciseId: UnitId): number;
  incrementFrequency(exerciseId: UnitId): void;
  /** Результат попытки: пул повторов и счётчики успеха. */
  noteResult(exerciseId: UnitId, grade: Grade): void;
  /** Доля успехов; 1.0, пока попыток не было (`get_success_rate`). */
  successRate(): number;
  trialCounts(): TrialCounts;
  reset(): void;
}

export const createSessionState = (deps: RelearnPileDeps): SessionState => {
  const relearnPile = createRelearnPile(deps);
  const frequencyMap = new Map<UnitId, number>();
  let success = 0;
  let failed = 0;

  const noteResult = (exerciseId: UnitId, grade: Grade) => {
    relearnPile.update(exerciseId, grade);
    if (grade >= PASSING_GRADE_MIN) success += 1;
    else failed += 1;
  };

  const successRate = () => {
    const total = success + failed;
    if (total === 0) return 1.0;
    const rate = success / total;
    return deps.precision === 'f32' ? Math.fround(rate) : rate;
  };

  return {
    relearnPile,
    frequencyOf: (exerciseId) => frequencyMap.get(exerciseId) ?? 0,
    incrementFrequency: (exerciseId) => {
      frequencyMap.set(exerciseId, (frequencyMap.get(exerciseId) ?? 0) + 1);
    },
    noteResult,
    successRate,
    trialCounts: () => ({ success, failed }),
    reset: () => {
      frequencyMap.clear();
      relearnPile.clear();
      success = 0;
      failed = 0;
    },
  };
};
