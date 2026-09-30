import type { EpochMs } from '@spirula-app/engine-contract';
import type { ExerciseType } from '../domain/manifest.ts';
import {
  type Constants,
  F32_EPSILON,
  OLD_GOOD_MIN_SCORES,
  constantEntries,
} from './constants.ts';
import { TrialsNotSortedError } from './errors.ts';
import {
  type Numeric,
  createNumeric,
  rustClamp,
  rustMax,
  rustMin,
} from './numeric.ts';
import { createPerformance, isNewestFirst } from './performance.ts';
import { createScorerDescriptor } from './scorer-info.ts';
import type {
  ExerciseDelta,
  ExerciseScore,
  ExerciseScorer,
  ExerciseTrial,
  Precision,
} from './types.ts';

export interface PowerLawScorerOptions {
  /** `'f64'` (по умолчанию) — продукция; `'f32'` — двойник для сверки с Rust. */
  readonly precision?: Precision;
}

/**
 * Приватные функции Rust-модуля: открыты, чтобы портированные тесты могли их
 * вызывать (в Rust тесты — дочерний модуль с доступом к приватному).
 */
export interface PowerLawInternals {
  elapsedDays(newerMs: EpochMs, olderMs: EpochMs): number;
  estimateDifficulty(previousTrials: readonly ExerciseTrial[]): number;
  computeWeightedAvg<T extends { readonly timestamp: number }>(
    entries: readonly T[],
    valueOf: (entry: T) => number,
  ): number;
  getCurveDecay(exerciseType: ExerciseType): number;
  getCurveFactor(exerciseType: ExerciseType): number;
  computeRetrievability(
    exerciseType: ExerciseType,
    daysSinceLast: number,
    stability: number,
  ): number;
  computeSpacingGain(
    exerciseType: ExerciseType,
    daysSincePreviousReview: number,
    stability: number,
    performanceFactor: number,
  ): number;
  updateDifficulty(
    difficulty: number,
    baseDifficulty: number,
    trialScore: number,
  ): number;
  applyStabilityTransition(
    exerciseType: ExerciseType,
    stability: number,
    difficulty: number,
    score: number,
    daysSincePreviousReview: number,
  ): number;
  computeStability(
    exerciseType: ExerciseType,
    previousTrials: readonly ExerciseTrial[],
    baseDifficulty: number,
  ): number;
  applyOldGoodRetrievabilityFloor(
    retrievability: number,
    weightedScore: number,
    daysSinceLast: number,
    numScores: number,
  ): number;
  computeDelta(
    previousDeltas: readonly ExerciseDelta[],
    retrievability: number,
  ): number;
  velocity(previousTrials: readonly ExerciseTrial[]): number | null;
}

export interface PowerLawScorer extends ExerciseScorer {
  readonly precision: Precision;
  readonly constants: Constants;
  readonly internals: PowerLawInternals;
}

const createInternals = (numeric: Numeric): PowerLawInternals => {
  const { round: r, constants: c, powf, elapsedDays } = numeric;
  const performance = createPerformance(numeric);

  const estimateDifficulty = (previousTrials: readonly ExerciseTrial[]) => {
    if (previousTrials.length === 0) return c.BASE_DIFFICULTY;

    let failures = 0;
    for (const trial of previousTrials) {
      if (r(trial.score) < c.PERFORMANCE_BASELINE_SCORE) failures += 1;
    }
    const failureRate = r(failures / previousTrials.length);
    const difficulty = r(1.0 + r(failureRate * 9.0));
    return rustClamp(difficulty, c.MIN_DIFFICULTY, c.MAX_DIFFICULTY);
  };

  const getCurveDecay = (exerciseType: ExerciseType) =>
    exerciseType === 'Declarative'
      ? c.DECLARATIVE_CURVE_DECAY
      : c.PROCEDURAL_CURVE_DECAY;

  /** Множитель, при котором `R(t = S)` равно `TARGET_RETRIEVABILITY_AT_STABILITY`. */
  const getCurveFactor = (exerciseType: ExerciseType) => {
    const decayAbs = rustMax(
      Math.abs(getCurveDecay(exerciseType)),
      F32_EPSILON,
    );
    const exponent = r(-1.0 / decayAbs);
    return r(powf(c.TARGET_RETRIEVABILITY_AT_STABILITY, exponent) - 1.0);
  };

  /** Степенная кривая `(1 + factor · t / S) ^ decay`, зажатая в 0..=1. */
  const computeRetrievability = (
    exerciseType: ExerciseType,
    daysSinceLast: number,
    stability: number,
  ) => {
    const decay = getCurveDecay(exerciseType);
    const factor = getCurveFactor(exerciseType);
    const base = r(1.0 + r(r(factor * daysSinceLast) / stability));
    return rustClamp(powf(base, decay), 0.0, 1.0);
  };

  /** Дополнительный рост при удачном повторе после долгого интервала. */
  const computeSpacingGain = (
    exerciseType: ExerciseType,
    daysSincePreviousReview: number,
    stability: number,
    performanceFactor: number,
  ) => {
    if (performanceFactor <= 0.0) return 1.0;

    const preReview = computeRetrievability(
      exerciseType,
      daysSincePreviousReview,
      stability,
    );
    return rustClamp(
      r(1.0 + r(c.SPACING_EFFECT_WEIGHT * r(1.0 - preReview))),
      1.0,
      r(1.0 + c.SPACING_EFFECT_WEIGHT),
    );
  };

  /** Сложность после повтора: тренд оценки, затем возврат к базовой. */
  const updateDifficulty = (
    difficulty: number,
    baseDifficulty: number,
    trialScore: number,
  ) => {
    const gradeDelta = r(
      r(r(c.PERFORMANCE_BASELINE_SCORE - r(trialScore)) / c.GRADE_RANGE) *
        c.DIFFICULTY_GRADE_ADJUSTMENT_SCALE,
    );
    const adjusted = rustClamp(
      r(difficulty + gradeDelta),
      c.MIN_DIFFICULTY,
      c.MAX_DIFFICULTY,
    );
    return rustClamp(
      r(
        r(c.DIFFICULTY_REVERSION_WEIGHT * baseDifficulty) +
          r(r(1.0 - c.DIFFICULTY_REVERSION_WEIGHT) * adjusted),
      ),
      c.MIN_DIFFICULTY,
      c.MAX_DIFFICULTY,
    );
  };

  const applyStabilityTransition = (
    exerciseType: ExerciseType,
    stability: number,
    difficulty: number,
    score: number,
    daysSincePreviousReview: number,
  ) => {
    const p = r(r(r(r(score) - c.GRADE_MIN) / c.GRADE_RANGE) - 0.5);
    const e = r(r(c.EASE_NUMERATOR_OFFSET - difficulty) / c.EASE_DENOMINATOR);
    const spacingGain = computeSpacingGain(
      exerciseType,
      daysSincePreviousReview,
      stability,
      p,
    );
    const intraDayDamping = rustMin(daysSincePreviousReview, 1.0);
    const growth = r(
      r(r(r(c.STABILITY_COEFFICIENT * p) * e) * spacingGain) * intraDayDamping,
    );
    return rustClamp(
      r(stability * r(1.0 + growth)),
      c.MIN_STABILITY,
      c.MAX_STABILITY,
    );
  };

  /** Реплей истории от старых к новым: текущая устойчивость. */
  const computeStability = (
    exerciseType: ExerciseType,
    previousTrials: readonly ExerciseTrial[],
    baseDifficulty: number,
  ) => {
    let stability = c.DEFAULT_STABILITY;
    let difficulty = baseDifficulty;
    let previousTimestamp: number | null = null;

    for (let i = previousTrials.length - 1; i >= 0; i--) {
      const trial = previousTrials[i] as ExerciseTrial;
      if (previousTimestamp === null) {
        previousTimestamp = trial.timestamp;
        continue;
      }

      const days = rustMax(
        elapsedDays(trial.timestamp, previousTimestamp),
        0.0,
      );
      stability = applyStabilityTransition(
        exerciseType,
        stability,
        difficulty,
        trial.score,
        days,
      );
      difficulty = updateDifficulty(difficulty, c.BASE_DIFFICULTY, trial.score);
      previousTimestamp = trial.timestamp;
    }
    return stability;
  };

  /** Пол извлекаемости для старых упражнений с сильной взвешенной оценкой. */
  const applyOldGoodRetrievabilityFloor = (
    retrievability: number,
    weightedScore: number,
    daysSinceLast: number,
    numScores: number,
  ) => {
    const isOldGood =
      numScores >= OLD_GOOD_MIN_SCORES &&
      weightedScore >= c.OLD_GOOD_MIN_SCORE &&
      daysSinceLast >= c.OLD_GOOD_MIN_AGE;
    return isOldGood
      ? rustMax(retrievability, c.OLD_GOOD_FLOOR)
      : retrievability;
  };

  return {
    elapsedDays,
    estimateDifficulty,
    computeWeightedAvg: performance.weightedAverage,
    getCurveDecay,
    getCurveFactor,
    computeRetrievability,
    computeSpacingGain,
    updateDifficulty,
    applyStabilityTransition,
    computeStability,
    applyOldGoodRetrievabilityFloor,
    computeDelta: performance.deltaTerm,
    velocity: performance.velocity,
  };
};

/**
 * Порт `PowerLawScorer` Trane v0.34.1 (`exercise_scorer.rs`): эталон для
 * сверки, продукция использует `FsrsScorer`. Время — мс.
 */
export const createPowerLawScorer = (
  options: PowerLawScorerOptions = {},
): PowerLawScorer => {
  const precision = options.precision ?? 'f64';
  const numeric = createNumeric(precision);
  const { round: r, constants: c, elapsedDays } = numeric;
  const internals = createInternals(numeric);

  const score = (
    exerciseType: ExerciseType,
    previousTrials: readonly ExerciseTrial[],
    previousDeltas: readonly ExerciseDelta[],
    now: EpochMs,
  ): ExerciseScore => {
    if (previousTrials.length === 0) {
      return { value: 0.0, urgency: 1.0, velocity: null };
    }
    if (!isNewestFirst(previousTrials)) throw new TrialsNotSortedError();

    const newest = (previousTrials[0] as ExerciseTrial).timestamp;
    const baseDifficulty = internals.estimateDifficulty(previousTrials);
    const stability = internals.computeStability(
      exerciseType,
      previousTrials,
      baseDifficulty,
    );
    const daysSinceLast = rustMax(elapsedDays(now, newest), 0.0);
    const retrievability = internals.computeRetrievability(
      exerciseType,
      daysSinceLast,
      stability,
    );

    const weightedScore = internals.computeWeightedAvg(
      previousTrials,
      (trial) => trial.score,
    );
    const effective = internals.applyOldGoodRetrievabilityFloor(
      retrievability,
      weightedScore,
      daysSinceLast,
      previousTrials.length,
    );
    const adjustedScore = r(effective * weightedScore);
    const delta = internals.computeDelta(previousDeltas, effective);

    return {
      value: rustClamp(r(adjustedScore + delta), 0.0, c.GRADE_MAX),
      urgency: r(1.0 - retrievability),
      velocity: internals.velocity(previousTrials),
    };
  };

  const info = createScorerDescriptor({
    kind: 'power-law',
    memoryModelId: 'power-law/trane@0.34.1',
    ratingMap: 'runner',
    parameters: [`precision=${precision}`, constantEntries()],
  });

  return { info, precision, constants: c, internals, score };
};
