import { F32_EPSILON } from './constants.ts';
import { type Numeric, rustClamp, rustMax } from './numeric.ts';
import type { ExerciseDelta, ExerciseTrial } from './types.ts';

export interface Timestamped {
  readonly timestamp: number;
}

/** Проверка порядка «от новых к старым»; равные метки допустимы. */
export const isNewestFirst = (entries: readonly Timestamped[]) => {
  for (let i = 0; i + 1 < entries.length; i++) {
    const current = entries[i] as Timestamped;
    const next = entries[i + 1] as Timestamped;
    if (current.timestamp < next.timestamp) return false;
  }
  return true;
};

export interface Performance {
  weightedAverage<T extends Timestamped>(
    entries: readonly T[],
    valueOf: (entry: T) => number,
  ): number;
  deltaTerm(deltas: readonly ExerciseDelta[], retrievability: number): number;
  velocity(trials: readonly ExerciseTrial[]): number | null;
  performance(
    trials: readonly ExerciseTrial[],
    deltas: readonly ExerciseDelta[],
  ): number;
}

/**
 * «Performance» Trane: взвешенная оценка попыток, поправка по deltas и наклон
 * оценок. Общий модуль `PowerLawScorer` и `FsrsScorer` (engine-ts.md §6).
 */
export const createPerformance = (numeric: Numeric): Performance => {
  const { round: r, constants: c, powf, elapsedDays } = numeric;

  /**
   * `0.8 · time_avg + 0.2 · pos_avg`: первое — веса убывают по неделям от
   * новейшей записи, второе — по порядковой позиции. Записи от новых к старым.
   */
  const weightedAverage = <T extends Timestamped>(
    entries: readonly T[],
    valueOf: (entry: T) => number,
  ) => {
    if (entries.length === 0) return 0.0;

    const newest = (entries[0] as T).timestamp;
    let timeWeighted = 0.0;
    let timeWeights = 0.0;
    for (const entry of entries) {
      const weeks = rustMax(r(elapsedDays(newest, entry.timestamp) / 7.0), 0.0);
      const weight = rustMax(
        powf(c.PERFORMANCE_WEIGHT_DECAY, weeks),
        c.PERFORMANCE_WEIGHT_MIN,
      );
      timeWeighted = r(timeWeighted + r(weight * r(valueOf(entry))));
      timeWeights = r(timeWeights + weight);
    }
    const timeAverage = r(timeWeighted / timeWeights);

    let positionWeighted = 0.0;
    let positionWeights = 0.0;
    for (let i = 0; i < entries.length; i++) {
      const weight = rustMax(
        powf(c.PERFORMANCE_WEIGHT_DECAY, i),
        c.PERFORMANCE_WEIGHT_MIN,
      );
      positionWeighted = r(
        positionWeighted + r(weight * r(valueOf(entries[i] as T))),
      );
      positionWeights = r(positionWeights + weight);
    }
    const positionAverage = r(positionWeighted / positionWeights);

    return r(
      r(c.WEIGHTED_AVG_TIME_SHARE * timeAverage) +
        r(c.WEIGHTED_AVG_POSITION_SHARE * positionAverage),
    );
  };

  /** Поправка по deltas: взвешенное среднее × извлекаемость / 4. */
  const deltaTerm = (
    deltas: readonly ExerciseDelta[],
    retrievability: number,
  ) => {
    if (deltas.length < 2) return 0.0;
    const average = weightedAverage(deltas, (delta) => delta.delta);
    return r(r(average * retrievability) / 4.0);
  };

  /** Наклон МНК «оценка от дней» (старейшая попытка — начало); `null` при < 2. */
  const velocity = (trials: readonly ExerciseTrial[]) => {
    if (trials.length < 2) return null;

    const oldest = (trials[trials.length - 1] as ExerciseTrial).timestamp;
    const n = trials.length;
    let sumT = 0.0;
    let sumScores = 0.0;
    let sumTScores = 0.0;
    let sumTSquared = 0.0;
    for (const trial of trials) {
      const t = elapsedDays(trial.timestamp, oldest);
      const s = r(trial.score);
      sumT = r(sumT + t);
      sumScores = r(sumScores + s);
      sumTScores = r(sumTScores + r(t * s));
      sumTSquared = r(sumTSquared + r(t * t));
    }
    const denominator = r(r(n * sumTSquared) - r(sumT * sumT));
    if (Math.abs(denominator) < F32_EPSILON) return 0.0;
    return r(r(r(n * sumTScores) - r(sumT * sumScores)) / denominator);
  };

  /**
   * Оценка «в момент последней попытки» (извлекаемость 1): `weightedAverage`
   * плюс `deltaTerm`, зажатая в 0..=5. Попытки от новых к старым.
   */
  const performance = (
    trials: readonly ExerciseTrial[],
    deltas: readonly ExerciseDelta[],
  ) => {
    const average = weightedAverage(trials, (trial) => trial.score);
    const value = r(average + deltaTerm(deltas, 1.0));
    return rustClamp(value, 0.0, c.GRADE_MAX);
  };

  return { weightedAverage, deltaTerm, velocity, performance };
};
