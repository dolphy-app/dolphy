/**
 * Порт 8 `#[test]` из `scheduler/reward_propagator.rs` (Trane v0.34.1,
 * строки 180-354) на локальном тестовом графе.
 */
import { describe, expect, it } from 'vitest';
import {
  MIN_ABS_REWARD,
  MIN_WEIGHT,
  type ScoringEdge,
  type ScoringGraph,
  type UnitReward,
  initialReward,
  propagateRewards,
  stopPropagation,
} from '../../src/scoring/index.ts';
import { type CourseSpec, createTestGraph } from './test-graph.ts';

/** Два пути от `0::0` к `0::3` с разными весами рёбер. */
const buildPathGraph = (sourceEncompassed: ScoringEdge[]) =>
  createTestGraph([
    {
      id: '0',
      lessons: [
        { id: '0::0', encompassed: sourceEncompassed, exercises: 1 },
        { id: '0::1', encompassed: [['0::3', 1.0]] },
        { id: '0::2', encompassed: [['0::3', 1.0]] },
        { id: '0::3' },
      ],
    },
  ]);

/** Как `propagate_five_rewards`: оценка 5 у упражнения `0::0::0`. */
const propagateFive = (graph: ScoringGraph) => {
  const rewards = propagateRewards(graph, '0::0::0', 5, 0);
  return new Map<string, UnitReward>(
    rewards.map((reward) => [reward.unitId, reward]),
  );
};

const lessonChain = (
  edges: Array<[from: string, to: string, weight: number]>,
) => {
  const lessons: CourseSpec['lessons'] = [
    { id: '0::0', exercises: 1 },
    { id: '0::1' },
    { id: '0::2' },
  ];
  for (const [from, to, weight] of edges) {
    const lesson = lessons.find(({ id }) => id === from);
    if (lesson) lesson.encompassed = [[to, weight]];
  }
  return createTestGraph([{ id: '0', lessons }]);
};

describe('RewardPropagator', () => {
  it('initial_reward', () => {
    expect(initialReward(5)).toBe(0.8);
    expect(initialReward(4)).toBe(0.4);
    expect(initialReward(3)).toBe(-0.3);
    expect(initialReward(2)).toBe(-0.5);
    expect(initialReward(1)).toBe(-1.0);
  });

  it('stop_propagation', () => {
    expect(stopPropagation(MIN_ABS_REWARD, MIN_WEIGHT)).toBe(false);
    expect(stopPropagation(MIN_ABS_REWARD - 0.001, MIN_WEIGHT)).toBe(true);
    expect(stopPropagation(-MIN_ABS_REWARD + 0.001, MIN_WEIGHT)).toBe(true);
    expect(stopPropagation(MIN_ABS_REWARD, MIN_WEIGHT - 0.001)).toBe(true);
  });

  it('strongest_path_wins', () => {
    const graph = buildPathGraph([
      ['0::1', 1.0],
      ['0::2', 0.5],
    ]);
    const reward = propagateFive(graph).get('0::3');
    expect(reward?.value).toBeCloseTo(0.72, 6);
    expect(reward?.weight).toBeCloseTo(0.8, 6);
  });

  it('strongest_path_is_order_independent', () => {
    const first = propagateFive(
      buildPathGraph([
        ['0::1', 1.0],
        ['0::2', 0.5],
      ]),
    ).get('0::3');
    const second = propagateFive(
      buildPathGraph([
        ['0::2', 0.5],
        ['0::1', 1.0],
      ]),
    ).get('0::3');
    expect(first?.value).toBeCloseTo(second?.value as number, 6);
    expect(first?.weight).toBeCloseTo(second?.weight as number, 6);
  });

  it('edge_weights_attenuate_reward_weight', () => {
    const graph = lessonChain([
      ['0::0', '0::1', 0.8],
      ['0::1', '0::2', 0.8],
    ]);
    const rewards = propagateFive(graph);
    const firstHop = rewards.get('0::1');
    expect(firstHop?.value).toBeCloseTo(0.64, 6);
    expect(firstHop?.weight).toBeCloseTo(0.8, 6);
    const secondHop = rewards.get('0::2');
    expect(secondHop?.value).toBeCloseTo(0.4608, 6);
    expect(secondHop?.weight).toBeCloseTo(0.512, 6);
  });

  it('weak_initial_edges_are_pruned', () => {
    const graph = lessonChain([['0::0', '0::1', 0.1]]);
    expect(propagateFive(graph).size).toBe(0);
  });

  it('weak_recursive_hops_are_pruned', () => {
    const graph = lessonChain([
      ['0::0', '0::1', 1.0],
      ['0::1', '0::2', 0.1],
    ]);
    const rewards = propagateFive(graph);
    expect(rewards.has('0::1')).toBe(true);
    expect(rewards.has('0::2')).toBe(false);
  });

  it('resolve_roots', () => {
    // Приватная `resolve_roots` проверяется через публичный вход: для
    // известного упражнения корни — его урок и курс, для неизвестного — пусто.
    const graph = createTestGraph([
      {
        id: 'course',
        lessons: [
          {
            id: 'lesson',
            exercises: ['exercise'],
            encompassed: [['other', 1.0]],
          },
          { id: 'other' },
        ],
      },
    ]);
    expect(propagateRewards(graph, 'exercise', 5, 7)).toEqual([
      { unitId: 'other', value: 0.8, weight: 1.0, timestamp: 7 },
    ]);
    expect(propagateRewards(graph, 'missing', 5, 7)).toEqual([]);
  });
});
