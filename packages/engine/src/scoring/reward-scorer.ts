import type { EpochMs } from '@lms/engine-contract';
import { MS_PER_DAY } from './constants.ts';
import type { ExerciseTrial, UnitReward } from './types.ts';

/** Число попыток, с которого награды начинают применяться. */
export const MIN_TRIALS_FOR_REWARD = 3;

/** Период полураспада значения и веса награды, дни. */
const REWARD_HALF_LIFE_DAYS = 14.0;
/** Награды с эффективным весом ниже игнорируются. */
const MIN_EFFECTIVE_WEIGHT = 0.05;
const COURSE_REWARDS_WEIGHT = 0.3;
/** Урок ближе к упражнению, чем курс, поэтому весит больше. */
const LESSON_REWARDS_WEIGHT = 0.7;
const RECENT_TRIALS = 3;
const RECENT_DAYS = 7.0;
const POOR_AVERAGE_SCORE = 3.0;
const GOOD_AVERAGE_SCORE = 3.5;

/**
 * Сворачивает награды урока и курса в число, прибавляемое к оценке упражнения
 * (`reward_scorer.rs`); `trials` идут от новых к старым.
 */
export interface RewardScorer {
  scoreRewards(
    courseRewards: readonly UnitReward[],
    lessonRewards: readonly UnitReward[],
    now: EpochMs,
  ): number;
  applyReward(
    reward: number,
    previousTrials: readonly ExerciseTrial[],
    now: EpochMs,
  ): boolean;
}

/** Целые дни с награды; награды из будущего не усиливаются (зажим в 0). */
export const daysSince = (reward: UnitReward, now: EpochMs) =>
  Math.floor(Math.max(now - reward.timestamp, 0) / MS_PER_DAY);

export const decayFactor = (days: number) =>
  0.5 ** (days / REWARD_HALF_LIFE_DAYS);

/** Значение и вес после затухания; затухание умножает и то и другое. */
export const decayedReward = (reward: UnitReward, now: EpochMs) => {
  const decay = decayFactor(daysSince(reward, now));
  return { value: reward.value * decay, weight: reward.weight * decay };
};

const weightedAverage = (rewards: readonly UnitReward[], now: EpochMs) => {
  let numerator = 0.0;
  let denominator = 0.0;
  for (const reward of rewards) {
    const { value, weight } = decayedReward(reward, now);
    if (weight < MIN_EFFECTIVE_WEIGHT) continue;
    numerator += value * weight;
    denominator += weight;
  }
  return denominator === 0.0 ? 0.0 : numerator / denominator;
};

const scoreRewards = (
  courseRewards: readonly UnitReward[],
  lessonRewards: readonly UnitReward[],
  now: EpochMs,
) => {
  const courseScore = weightedAverage(courseRewards, now);
  const lessonScore = weightedAverage(lessonRewards, now);
  const hasCourse = courseRewards.length > 0;
  const hasLesson = lessonRewards.length > 0;

  if (!hasCourse && !hasLesson) return 0.0;
  if (!hasCourse) return lessonScore;
  if (!hasLesson) return courseScore;
  const numerator =
    courseScore * COURSE_REWARDS_WEIGHT + lessonScore * LESSON_REWARDS_WEIGHT;
  return numerator / (COURSE_REWARDS_WEIGHT + LESSON_REWARDS_WEIGHT);
};

/**
 * Не поощрять плохо идущие упражнения и не штрафовать хорошо идущие, пока
 * последняя попытка свежее недели; при < 3 попыток награды не применяются.
 */
const applyReward = (
  reward: number,
  previousTrials: readonly ExerciseTrial[],
  now: EpochMs,
) => {
  if (previousTrials.length < MIN_TRIALS_FOR_REWARD) return false;

  const last = previousTrials[0] as ExerciseTrial;
  const numDays = (now - last.timestamp) / MS_PER_DAY;
  let sum = 0;
  for (let i = 0; i < RECENT_TRIALS; i++) {
    sum += (previousTrials[i] as ExerciseTrial).score;
  }
  const averageScore = sum / RECENT_TRIALS;
  const isRecent = numDays < RECENT_DAYS;

  if (reward > 0.0 && averageScore < POOR_AVERAGE_SCORE && isRecent) {
    return false;
  }
  if (reward < 0.0 && averageScore > GOOD_AVERAGE_SCORE && isRecent) {
    return false;
  }
  return true;
};

export const createWeightedRewardScorer = (): RewardScorer => ({
  scoreRewards,
  applyReward,
});
