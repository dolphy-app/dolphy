/**
 * Golden L1: `WeightedRewardScorer` против настоящего Rust Trane v0.34.1 на
 * `reward-scorer.jsonl` (генератор `golden-rs/src/bin/reward_golden.rs`):
 * 1 500 кейсов `score_rewards` и 1 500 — `apply_reward`. Rust считает в f32,
 * TS — в f64: число сверяется с допуском, решение `apply_reward` — точно
 * (на дискретных решениях допуска нет).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type ExerciseTrial,
  type UnitReward,
  createWeightedRewardScorer,
} from '../../src/scoring/index.ts';

interface WireReward {
  value: number;
  weight: number;
  timestamp: number;
}
type WireCase =
  | {
      id: number;
      kind: 'score_rewards';
      course: WireReward[];
      lesson: WireReward[];
      now: number;
      expect: number;
    }
  | {
      id: number;
      kind: 'apply_reward';
      reward: number;
      trials: Array<{ score: number; timestamp: number }>;
      now: number;
      expect: boolean;
    };

const path = fileURLToPath(new URL('./reward-scorer.jsonl', import.meta.url));
const cases = readFileSync(path, 'utf8')
  .split('\n')
  .filter((line) => line.length > 0)
  .map((line) => JSON.parse(line) as WireCase);

const SCORE_ATOL = 1e-5;
const scorer = createWeightedRewardScorer();

/** Rust — секунды, TS — миллисекунды. */
const toReward = (wire: WireReward): UnitReward => ({
  unitId: '',
  value: wire.value,
  weight: wire.weight,
  timestamp: wire.timestamp * 1000,
});
const toTrial = (wire: {
  score: number;
  timestamp: number;
}): ExerciseTrial => ({
  score: wire.score,
  timestamp: wire.timestamp * 1000,
});

describe('golden L1 WeightedRewardScorer vs Rust', () => {
  const scoreCases = cases.filter((golden) => golden.kind === 'score_rewards');
  const applyCases = cases.filter((golden) => golden.kind === 'apply_reward');

  it('has the documented shape', () => {
    expect(scoreCases).toHaveLength(1500);
    expect(applyCases).toHaveLength(1500);
    const decisions = applyCases.map((golden) => golden.expect);
    expect(decisions.filter(Boolean).length).toBeGreaterThan(400);
    expect(decisions.filter((decision) => !decision).length).toBeGreaterThan(
      400,
    );
  });

  it('score_rewards within tolerance', () => {
    const failures = scoreCases
      .filter((golden) => golden.kind === 'score_rewards')
      .filter((golden) => {
        const got = scorer.scoreRewards(
          golden.course.map(toReward),
          golden.lesson.map(toReward),
          golden.now * 1000,
        );
        return Math.abs(got - golden.expect) > SCORE_ATOL;
      })
      .map((golden) => golden.id);
    expect(failures).toEqual([]);
  });

  it('apply_reward decisions equal Rust for every case', () => {
    const failures = applyCases
      .filter((golden) => golden.kind === 'apply_reward')
      .filter((golden) => {
        const got = scorer.applyReward(
          golden.reward,
          golden.trials.map(toTrial),
          golden.now * 1000,
        );
        return got !== golden.expect;
      })
      .map((golden) => golden.id);
    expect(failures).toEqual([]);
  });
});
