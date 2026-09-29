import type { EpochMs } from '@lms/engine-contract';
import type { ExerciseType } from '../domain/manifest.ts';
import type { MemoryModel, MemoryState } from '../ports/index.ts';
import { MS_PER_DAY } from './constants.ts';
import { createNumeric, rustClamp } from './numeric.ts';
import { createPerformance, isNewestFirst } from './performance.ts';
import { type RatingMapName, ratingOf } from './rating-map.ts';
import { createScorerDescriptor } from './scorer-info.ts';
import type {
  ExerciseDelta,
  ExerciseScore,
  ExerciseScorer,
  ExerciseTrial,
} from './types.ts';

/** Разрыв между повторами усекается (100 лет), чтобы числа оставались конечными. */
const MAX_DELTA_DAYS = 36_500;
const GRADE_MAX = 5;

export interface FsrsScorerOptions {
  readonly memory: MemoryModel;
  /** По умолчанию `runner`; `anki` — для самооценки. */
  readonly ratingMap?: RatingMapName;
}

/** Состояние памяти после реплея и время последней попытки. */
export interface ReplayedMemory {
  readonly state: MemoryState;
  readonly lastAt: EpochMs;
}

export interface FsrsScorer extends ExerciseScorer {
  readonly ratingMap: RatingMapName;
  /** Реплей попыток (любой порядок) через `MemoryModel.step`; `null` для пустой истории. */
  replay(trials: readonly ExerciseTrial[]): ReplayedMemory | null;
}

/** Стабильная сортировка по времени; равные метки сохраняют порядок входа. */
const sortedBy = (
  trials: readonly ExerciseTrial[],
  direction: 'ascending' | 'descending',
) => {
  const sign = direction === 'ascending' ? 1 : -1;
  return [...trials].sort((a, b) => sign * (a.timestamp - b.timestamp));
};

/**
 * `FsrsScorer`, вариант H (engine-ts.md §6): реплей попыток через порт
 * `MemoryModel`, `R = retrievability(state, дни с последней попытки)`,
 * `value = clamp(R × performance, 0, 5)`, `urgency = 1 − R`, `velocity` —
 * наклон оценок. Тип упражнения FSRS не различает.
 */
export const createFsrsScorer = ({
  memory,
  ratingMap = 'runner',
}: FsrsScorerOptions): FsrsScorer => {
  const performance = createPerformance(createNumeric('f64'));

  const replay = (trials: readonly ExerciseTrial[]) => {
    if (trials.length === 0) return null;

    const ascending = isNewestFirst(trials)
      ? [...trials].reverse()
      : sortedBy(trials, 'ascending');
    let state: MemoryState | null = null;
    let previousAt = 0;
    for (let i = 0; i < ascending.length; i++) {
      const trial = ascending[i] as ExerciseTrial;
      const gapMs = i === 0 ? 0 : Math.max(trial.timestamp - previousAt, 0);
      const wholeDays = Math.min(
        Math.floor(gapMs / MS_PER_DAY),
        MAX_DELTA_DAYS,
      );
      state = memory.step(state, wholeDays, ratingOf(ratingMap, trial.score));
      previousAt = trial.timestamp;
    }
    return { state: state as MemoryState, lastAt: previousAt };
  };

  const score = (
    _exerciseType: ExerciseType,
    previousTrials: readonly ExerciseTrial[],
    previousDeltas: readonly ExerciseDelta[],
    now: EpochMs,
  ): ExerciseScore => {
    const replayed = replay(previousTrials);
    if (replayed === null) return { value: 0.0, urgency: 1.0, velocity: null };

    const { state, lastAt } = replayed;
    const days = Math.max(now - lastAt, 0) / MS_PER_DAY;
    const raw = memory.retrievability(state, Number.isNaN(days) ? 0 : days);
    const retrievability = Number.isFinite(raw) ? rustClamp(raw, 0, 1) : 0;

    const newestFirst = isNewestFirst(previousTrials)
      ? previousTrials
      : sortedBy(previousTrials, 'descending');
    const value = performance.performance(newestFirst, previousDeltas);
    const velocity = performance.velocity(newestFirst);
    return {
      value: Number.isFinite(value)
        ? rustClamp(retrievability * value, 0, GRADE_MAX)
        : 0,
      urgency: rustClamp(1 - retrievability, 0, 1),
      velocity:
        velocity !== null && Number.isFinite(velocity) ? velocity : null,
    };
  };

  const info = createScorerDescriptor({
    kind: 'fsrs-hybrid',
    memoryModelId: memory.id,
    ratingMap,
    parameters: [memory.id, ratingMap],
  });

  return { info, ratingMap, replay, score };
};
