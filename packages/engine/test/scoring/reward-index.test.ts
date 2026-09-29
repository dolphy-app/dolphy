/**
 * T-02 (engine-ts-testing.md §7): дедуп «похожих» наград — одинаковое `value`,
 * `|Δt| < 86 400 000 мс`, `|Δw| < 0.1`; границы равенства — не пропуск; кэп
 * 20 наград на юнит; результат не зависит от перезапуска процесса.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_REWARDS_PER_UNIT,
  REWARD_DEDUP_INTERVAL_MS,
  REWARD_DEDUP_WINDOW,
  type UnitReward,
  createRewardIndex,
  insertReward,
  propagateRewards,
} from '../../src/scoring/index.ts';
import { createTestGraph } from './test-graph.ts';

const T0 = 1_800_000_000_000;
const DAY_MS = 86_400_000;

const reward = (
  value: number,
  weight: number,
  timestamp: number,
  unitId = 'lesson',
): UnitReward => ({ unitId, value, weight, timestamp });

describe('reward dedup (T-02)', () => {
  it('skips a reward with the same value, close time and close weight', () => {
    const index = createRewardIndex();
    expect(index.record([reward(0.8, 1.0, T0)])).toEqual(['lesson']);
    expect(index.record([reward(0.8, 1.05, T0 + DAY_MS - 1)])).toEqual([]);
    expect(index.record([reward(0.8, 0.95, T0 - DAY_MS + 1)])).toEqual([]);
    expect(index.getRewards('lesson', 20)).toHaveLength(1);
  });

  it('does not skip on equality boundaries or a different value', () => {
    const index = createRewardIndex();
    index.record([reward(0.8, 0.0, T0)]);
    // |Δt| ровно 86 400 000 мс — не «похожая».
    expect(
      index.record([reward(0.8, 0.0, T0 + REWARD_DEDUP_INTERVAL_MS)]),
    ).toEqual(['lesson']);
    // |Δw| ровно 0.1 — не «похожая» (0 и 0.1 точно представимы).
    expect(index.record([reward(0.8, 0.1, T0 + 10 * DAY_MS)])).toEqual([
      'lesson',
    ]);
    index.record([reward(0.4, 0.0, T0 + 20 * DAY_MS)]);
    // Другое `value` при тех же времени и весе — не «похожая».
    expect(index.record([reward(0.4000001, 0.0, T0 + 20 * DAY_MS)])).toEqual([
      'lesson',
    ]);
    expect(index.getRewards('lesson', 20)).toHaveLength(5);
  });

  it('keeps at most 20 rewards per unit and evicts the oldest', () => {
    const index = createRewardIndex();
    const rewards = Array.from({ length: MAX_REWARDS_PER_UNIT + 1 }, (_, i) =>
      reward(1 + i, 1.0, T0 + i * 2 * DAY_MS),
    );
    index.record(rewards);
    const kept = index.getRewards('lesson', 100);
    expect(kept).toHaveLength(MAX_REWARDS_PER_UNIT);
    expect(kept[0]?.value).toBe(21);
    expect(kept.at(-1)?.value).toBe(2);
  });

  it('a reward older than the 20 newest is dropped and reports no change', () => {
    const index = createRewardIndex();
    index.record(
      Array.from({ length: MAX_REWARDS_PER_UNIT }, (_, i) =>
        reward(1 + i, 1.0, T0 + (i + 10) * 2 * DAY_MS),
      ),
    );
    expect(index.record([reward(99, 1.0, T0)])).toEqual([]);
    expect(
      index.getRewards('lesson', 100).some((known) => known.value === 99),
    ).toBe(false);
  });

  it('compares only with the newest REWARD_DEDUP_WINDOW retained rewards', () => {
    const retained = Array.from({ length: REWARD_DEDUP_WINDOW + 1 }, (_, i) =>
      reward(1 + i, 1.0, T0 + i * 2 * DAY_MS),
    ).reverse(); // от новых к старым; самая старая — value 1
    const twinOfOldest = reward(1, 1.0, T0 + 1000);
    expect(insertReward(retained, twinOfOldest)).not.toBeNull();
    const twinOfNewest = reward(
      REWARD_DEDUP_WINDOW + 1,
      1.0,
      T0 + REWARD_DEDUP_WINDOW * 2 * DAY_MS + 1000,
    );
    expect(insertReward(retained, twinOfNewest)).toBeNull();
  });

  it('places a reward with an equal timestamp before the older entries', () => {
    const first = reward(1, 1.0, T0);
    const second = reward(2, 1.0, T0);
    const list = insertReward([first], second);
    expect(list).toEqual([second, first]);
  });

  it('gives the same rewards after a restart (rebuild from the same journal)', () => {
    const graph = createTestGraph([
      {
        id: 'c',
        lessons: [
          { id: 'c::a', exercises: 1, encompassed: [['c::b', 1.0]] },
          { id: 'c::b', encompassed: [['c::c', 1.0]] },
          { id: 'c::c' },
        ],
      },
    ]);
    // Одна и та же попытка дважды в пределах суток и разные оценки после.
    const attempts = [
      { at: T0, grade: 5 },
      { at: T0 + 1000, grade: 5 },
      { at: T0 + 2 * DAY_MS, grade: 4 },
      { at: T0 + 3 * DAY_MS, grade: 5 },
    ] as const;
    const build = () => {
      const index = createRewardIndex();
      for (const { at, grade } of attempts) {
        index.record(propagateRewards(graph, 'c::a::0', grade, at));
      }
      return index;
    };
    const live = build();
    const rebuilt = build();
    for (const unitId of ['c::b', 'c::c']) {
      expect(rebuilt.getRewards(unitId, 20)).toEqual(
        live.getRewards(unitId, 20),
      );
    }
    // Вторая пятёрка (на секунду позже первой) отсеяна как «похожая».
    const values = live
      .getRewards('c::b', 20)
      .map(({ timestamp }) => timestamp);
    expect(values).toEqual([T0 + 3 * DAY_MS, T0 + 2 * DAY_MS, T0]);
  });

  it('returns the newest rewards first and respects the limit', () => {
    const index = createRewardIndex();
    index.record([
      reward(1, 1.0, T0),
      reward(2, 1.0, T0 + 2 * DAY_MS),
      reward(3, 1.0, T0 + 4 * DAY_MS),
    ]);
    const newest = index.getRewards('lesson', 2);
    expect(newest.map(({ value }) => value)).toEqual([3, 2]);
    expect(index.getRewards('missing', 10)).toEqual([]);
    index.clear();
    expect(index.getRewards('lesson', 10)).toEqual([]);
  });
});
