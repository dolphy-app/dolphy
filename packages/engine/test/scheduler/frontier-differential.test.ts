/**
 * T-49: дифференциальный тест `getFrontier` против настоящего Rust-Trane
 * v0.34.1. Эталон — `golden/frontier.jsonl` (генератор `golden-rs`,
 * `scheduler_frontier_golden`): множество уроков без единой попытки, чьи
 * упражнения попали хотя бы в один из 1500 батчей. Состояние ученика
 * восстанавливается теми же попытками; TS-фронтир должен совпасть с множеством
 * Rust везде, кроме перечисленного ниже намеренного расхождения.
 */
import type { UnitId } from '@dolphy-app/engine-contract';
import { describe, expect, it } from 'vitest';
import { readGoldenJsonl } from './helpers/golden.ts';
import { createWorld } from './helpers/world.ts';
import type { WorldCourseSpec } from './helpers/world.ts';

interface GoldenAttempt {
  exerciseId: UnitId;
  score: 1 | 2 | 3 | 4 | 5;
  agoMs: number;
}

interface FrontierCase {
  id: string;
  group: string;
  library: { courses: WorldCourseSpec[] };
  blacklist: UnitId[];
  attempts: GoldenAttempt[];
  nowMs: number;
  expect: { sourceLessons: UnitId[] };
}

interface FrontierHeader {
  nowMs: number;
}

const fixture = readGoldenJsonl<FrontierHeader, FrontierCase>('frontier.jsonl');

/** Число попыток и их порядок — как в Rust: старые первыми. */
const buildWorld = (golden: FrontierCase) => {
  const world = createWorld({
    courses: golden.library.courses,
    precision: 'f32',
    startMs: golden.nowMs,
    seed: 1,
  });
  for (const id of golden.blacklist) world.blacklist.add(id);
  for (const { exerciseId, score, agoMs } of golden.attempts) {
    world.record(exerciseId, score, {
      atMs: golden.nowMs - agoMs,
      noteSession: false,
    });
  }
  return world;
};

/**
 * Намеренное расхождение: DFS Trane достигает зависимых курса только после
 * прохождения всех его уроков, поэтому зависимые курса, вытесненного до
 * завершения его уроков, недостижимы; фронтир считает вытесненный юнит
 * выполненным (`satisfied_effective_dependency`) и открывает их.
 */
const INTENDED_DIVERGENCES: Record<string, UnitId[]> = {
  'fr-superseded-course-blocked-lesson': ['3::0'],
};

describe('T-49: getFrontier против Rust get_exercise_batch', () => {
  it('fixture непустой и содержит все группы состояний', () => {
    const groups = new Set(fixture.cases.map((golden) => golden.group));
    expect(fixture.cases.length).toBeGreaterThanOrEqual(40);
    for (const group of [
      'untouched-lesson',
      'untouched-dependency',
      'empty-lesson',
      'chain',
      'course-deps',
      'blacklist',
      'superseded',
      'mixed',
    ]) {
      expect(groups).toContain(group);
    }
  });

  it.each(fixture.cases.map((golden) => [golden.id, golden] as const))(
    '%s',
    (_id, golden) => {
      const world = buildWorld(golden);
      const frontier = world.getFrontier().map((item) => item.lessonId);
      const divergence = INTENDED_DIVERGENCES[golden.id];
      expect(frontier.sort()).toEqual(
        divergence ?? golden.expect.sourceLessons,
      );
    },
  );
});
