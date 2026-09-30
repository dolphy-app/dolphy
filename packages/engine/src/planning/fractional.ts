import { computeDecayFactor, default_w as defaultWeights } from 'ts-fsrs';
import type { EpochMs } from '@spirula-app/engine-contract';
import type { MemoryModel } from '../ports/index.ts';
import { MS_PER_DAY } from '../scoring/constants.ts';

/** Разрыв между обзорами усекается (100 лет), как в `FsrsScorer`. */
const MAX_DELTA_DAYS = 36_500;

export type Rating = 1 | 2 | 3 | 4;

/** Кривая забывания `R(t) = (1 + factor·t/S)^decay`, `decay < 0`, `R(S) = 0.9`. */
export interface ForgettingCurve {
  readonly decay: number;
  readonly factor: number;
}

/** Кривая ts-fsrs 5.4.2 с параметрами по умолчанию (`decay = −w[20]`). */
export const FSRS_CURVE: ForgettingCurve = Object.freeze(
  computeDecayFactor(defaultWeights),
);

/** Состояние памяти упражнения: FSRS-состояние и момент (возможно виртуального) обзора. */
export interface FireState {
  readonly stability: number;
  readonly difficulty: number;
  readonly lastAt: EpochMs;
}

export interface FractionalOptions {
  /**
   * `false` — сложность не меняется (v1: дрейф `D` при десятках кредитов на
   * попытку не измерен, engine-ts.md §6a.2). По умолчанию `true`, как в спайке.
   */
  readonly updateDifficulty?: boolean;
}

export interface FractionalStepper {
  /** Реальный обзор в `now` (`null` — первый). */
  review(state: FireState | null, now: EpochMs, rating: Rating): FireState;
  /** Извлекаемость `R` в `now`; `null` — 0. */
  retrievability(state: FireState | null, now: EpochMs): number;
  /**
   * Дробный (неявный) обзор с весом `w ∈ [0, 1]`. `null` → `null`; `w ≤ 0` —
   * копия состояния; `w ≥ 1` — реальный обзор. Виртуальный момент обзора
   * выбран так, чтобы `R(now) = R0 + w(1 − R0)` при новой стабильности.
   */
  fractional(
    state: FireState | null,
    now: EpochMs,
    rating: Rating,
    w: number,
    options?: FractionalOptions,
  ): FireState | null;
}

const wholeDaysBetween = (from: EpochMs, to: EpochMs) =>
  Math.min(Math.floor(Math.max(0, to - from) / MS_PER_DAY), MAX_DELTA_DAYS);

const CURVE_CHECK_STABILITY = 2;
const CURVE_CHECK_DAYS = 3;
const CURVE_CHECK_TOLERANCE = 1e-6;

/**
 * Дробный шаг поверх `MemoryModel`. Обратная функция кривой (`tau`) нужна
 * дробному шагу, а порт её не отдаёт, поэтому кривая передаётся явно; проверка
 * при создании отвергает модель с другой кривой, чтобы кредит не считался молча
 * неверно.
 */
export const createFractionalStepper = (
  model: MemoryModel,
  curve: ForgettingCurve = FSRS_CURVE,
): FractionalStepper => {
  const { decay, factor } = curve;
  const probe = model.retrievability(
    { stability: CURVE_CHECK_STABILITY, difficulty: 5 },
    CURVE_CHECK_DAYS,
  );
  const expected =
    (1 + (factor * CURVE_CHECK_DAYS) / CURVE_CHECK_STABILITY) ** decay;
  if (!(Math.abs(probe - expected) < CURVE_CHECK_TOLERANCE)) {
    throw new RangeError(
      `memory model ${model.id} does not follow the given forgetting curve`,
    );
  }

  const retrievability = (state: FireState | null, now: EpochMs) =>
    state === null
      ? 0
      : model.retrievability(
          state,
          Math.max(0, now - state.lastAt) / MS_PER_DAY,
        );

  const review = (
    state: FireState | null,
    now: EpochMs,
    rating: Rating,
  ): FireState => {
    const wholeDays = state === null ? 0 : wholeDaysBetween(state.lastAt, now);
    const next = model.step(state, wholeDays, rating);
    return {
      stability: next.stability,
      difficulty: next.difficulty,
      lastAt: now,
    };
  };

  const fractional: FractionalStepper['fractional'] = (
    state,
    now,
    rating,
    w,
    { updateDifficulty = true } = {},
  ) => {
    if (state === null) return null;
    if (!(w > 0)) return { ...state };
    if (w >= 1) {
      const next = review(state, now, rating);
      return updateDifficulty
        ? next
        : { ...next, difficulty: state.difficulty };
    }
    const days = Math.max(0, now - state.lastAt) / MS_PER_DAY;
    const r0 = model.retrievability(state, days);
    const plus = model.step(state, wholeDaysBetween(state.lastAt, now), rating);
    const stability = state.stability + w * (plus.stability - state.stability);
    const difficulty = updateDifficulty
      ? state.difficulty + w * (plus.difficulty - state.difficulty)
      : state.difficulty;
    const r1 = r0 + w * (1 - r0);
    let tau = 0;
    if (r1 < 1) {
      tau = (stability / factor) * (r1 ** (1 / decay) - 1);
      if (!Number.isFinite(tau) || tau < 0)
        tau = Number.isFinite(tau) ? 0 : days;
    }
    return { stability, difficulty, lastAt: now - tau * MS_PER_DAY };
  };

  return { review, retrievability, fractional };
};
