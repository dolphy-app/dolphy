/**
 * Порт 12 `#[test]` из `reward_scorer.rs` (Trane v0.34.1, строки 148-509).
 * `Utc::now()` заменён фиксированным `NOW`; время в мс. Суточные границы
 * `days_since` — целочисленное деление, поэтому `NOW` фиксирован.
 */
import { describe, expect, it } from 'vitest';
import {
  type ExerciseTrial,
  type UnitReward,
  createWeightedRewardScorer,
  decayFactor,
  decayedReward,
} from '../../src/scoring/index.ts';

const DAY_MS = 86_400_000;
const NOW = 1_800_000_000_000;

const daysAgo = (days: number) => NOW - days * DAY_MS;
const daysAhead = (days: number) => NOW + days * DAY_MS;

const reward = (
  value: number,
  weight: number,
  timestamp: number,
): UnitReward => ({
  unitId: '',
  value,
  weight,
  timestamp,
});
const trial = (score: number, timestamp: number): ExerciseTrial => ({
  score,
  timestamp,
});

const scorer = createWeightedRewardScorer();

describe('WeightedRewardScorer', () => {
  it('test_decay_factor', () => {
    expect(Math.abs(decayFactor(0.0) - 1.0)).toBeLessThan(0.000_001);
    expect(Math.abs(decayFactor(14.0) - 0.5)).toBeLessThan(0.001);
    expect(Math.abs(decayFactor(28.0) - 0.25)).toBeLessThan(0.001);
  });

  it('test_decayed_reward', () => {
    const positive = decayedReward(reward(1.0, 2.0, daysAgo(14)), NOW);
    expect(positive.value).toBeCloseTo(0.5, 3);
    expect(positive.weight).toBeCloseTo(1.0, 3);

    const negative = decayedReward(reward(-1.0, 1.0, daysAgo(14)), NOW);
    expect(negative.value).toBeCloseTo(-0.5, 3);
    expect(negative.weight).toBeCloseTo(0.5, 3);
  });

  it('test_decay_uses_provided_time', () => {
    // Ровно один полураспад от `now`, не связанного со стенными часами.
    const decayed = decayedReward(
      reward(1.0, 2.0, 1_000_000),
      1_000_000 + 14 * DAY_MS,
    );
    expect(decayed.value).toBeCloseTo(0.5, 3);
    expect(decayed.weight).toBeCloseTo(1.0, 3);
  });

  it('test_future_timestamp_is_clamped', () => {
    const decayed = decayedReward(reward(1.0, 2.0, daysAhead(3)), NOW);
    expect(decayed.value).toBeCloseTo(1.0, 3);
    expect(decayed.weight).toBeCloseTo(2.0, 3);
  });

  it('test_no_rewards', () => {
    expect(scorer.scoreRewards([], [], NOW)).toBe(0.0);
  });

  it('test_only_lesson_rewards', () => {
    const lesson = [reward(1.0, 1.0, daysAgo(1)), reward(2.0, 1.0, daysAgo(2))];
    expect(scorer.scoreRewards([], lesson, NOW)).toBeCloseTo(1.371, 3);
  });

  it('test_only_course_rewards', () => {
    const course = [reward(1.0, 1.0, daysAgo(1)), reward(2.0, 1.0, daysAgo(2))];
    expect(scorer.scoreRewards(course, [], NOW)).toBeCloseTo(1.371, 3);
  });

  it('test_both_rewards', () => {
    const course = [reward(1.0, 1.0, daysAgo(1)), reward(2.0, 1.0, daysAgo(2))];
    const lesson = [reward(2.0, 1.0, daysAgo(1)), reward(4.0, 2.0, daysAgo(2))];
    expect(scorer.scoreRewards(course, lesson, NOW)).toBeCloseTo(2.533, 3);
  });

  it('test_min_weight', () => {
    const lesson = [
      reward(2.0, 1.0, daysAgo(0)),
      reward(1.0, 0.0001, daysAgo(0) - 1000),
    ];
    expect(scorer.scoreRewards([], lesson, NOW)).toBeCloseTo(2.0, 3);
  });

  it('test_stale_rewards_do_not_drag_denominator', () => {
    const lesson = [
      reward(1.0, 10.0, daysAgo(70)),
      reward(1.0, 1.0, daysAgo(0)),
    ];
    expect(scorer.scoreRewards([], lesson, NOW)).toBeGreaterThan(0.7);
  });

  it('test_apply_reward_uses_provided_time', () => {
    const trials = [
      trial(2.0, 1_000_000),
      trial(2.0, 1_000_000),
      trial(3.0, 1_000_000),
    ];
    // Последняя попытка моложе недели: положительная награда не применяется.
    expect(scorer.applyReward(0.5, trials, 1_000_000 + 2 * DAY_MS)).toBe(false);
    // Через неделю и больше — применяется.
    expect(scorer.applyReward(0.5, trials, 1_000_000 + 8 * DAY_MS)).toBe(true);
  });

  it('test_apply_rewards', () => {
    // Меньше трёх попыток: награды не применяются.
    const few = [trial(2.0, daysAgo(1))];
    expect(scorer.applyReward(0.5, few, NOW)).toBe(false);
    expect(scorer.applyReward(-1.0, few, NOW)).toBe(false);

    // Среднее последних трёх < 3 и последняя моложе недели: `+` нельзя, `−` можно.
    const poor = [
      trial(2.0, daysAgo(1)),
      trial(2.0, daysAgo(8)),
      trial(3.0, daysAgo(10)),
    ];
    expect(scorer.applyReward(0.5, poor, NOW)).toBe(false);
    expect(scorer.applyReward(-1.0, poor, NOW)).toBe(true);

    // Среднее > 3.5 и последняя моложе недели: `−` нельзя, `+` можно.
    const good = [
      trial(4.0, daysAgo(1)),
      trial(5.0, daysAgo(8)),
      trial(4.0, daysAgo(10)),
    ];
    expect(scorer.applyReward(-0.5, good, NOW)).toBe(false);
    expect(scorer.applyReward(1.0, good, NOW)).toBe(true);

    // Остальные случаи: применяются.
    const middling = [
      trial(3.0, daysAgo(1)),
      trial(3.0, daysAgo(8)),
      trial(4.0, daysAgo(10)),
    ];
    expect(scorer.applyReward(0.5, middling, NOW)).toBe(true);
    const mixed = [
      trial(2.0, daysAgo(1)),
      trial(3.0, daysAgo(8)),
      trial(2.0, daysAgo(10)),
    ];
    expect(scorer.applyReward(-0.5, mixed, NOW)).toBe(true);
  });
});
