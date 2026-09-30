import type {
  EpochMs,
  ScorerInfoDto,
  UnitId,
} from '@spirula-app/engine-contract';
import type { ExerciseType } from '../domain/manifest.ts';

/**
 * Числовая модель модулей с чувствительными порогами: `f64` — продукция,
 * `f32` — двойник `Math.fround` только для сверки с Rust (engine-ts.md §6).
 */
export type Precision = 'f64' | 'f32';

/** Результат одной попытки; `score` — оценка 1–5, `timestamp` — мс. */
export interface ExerciseTrial {
  readonly score: number;
  readonly timestamp: EpochMs;
}

/** Расхождение предсказанной и фактической оценки (deltas Trane). */
export interface ExerciseDelta {
  readonly delta: number;
  readonly timestamp: EpochMs;
}

/** Оценка упражнения с эвристиками для фильтрации батча. */
export interface ExerciseScore {
  /** Освоенность, 0..=5. */
  readonly value: number;
  /** Насколько срочно повторять, 0..=1. */
  readonly urgency: number;
  /** Тренд оценок в баллах за день; `null`, если попыток меньше двух. */
  readonly velocity: number | null;
}

/** Часть `ScorerInfoDto`, которую знает сам скорер; `numTrials` — из опций. */
export type ScorerDescriptor = Omit<ScorerInfoDto, 'numTrials'>;

/**
 * Интерфейс `ExerciseScorer` из Trane: `previousTrials` и `previousDeltas`
 * идут от новых к старым, `now` — мс.
 */
export interface ExerciseScorer {
  readonly info: ScorerDescriptor;
  score(
    exerciseType: ExerciseType,
    previousTrials: readonly ExerciseTrial[],
    previousDeltas: readonly ExerciseDelta[],
    now: EpochMs,
  ): ExerciseScore;
}

/** Награда юнита; знак задаёт направление распространения. */
export interface UnitReward {
  readonly unitId: UnitId;
  readonly value: number;
  readonly weight: number;
  readonly timestamp: EpochMs;
}
