/**
 * L4: распределительный паритет с настоящим Rust-Trane v0.34.1
 * (engine-ts-testing.md §4). Эталон — `golden/l4.jsonl` (`scheduler_l4_golden`):
 * частоты попадания упражнений и уроков в батч и распределение размеров батча
 * по 5000 батчей на состояние; каждый батч — заново открытый `Trane`
 * (пустые карта показов и пул повторов, success rate 1.0), поэтому TS-сторона
 * сбрасывает `SessionState` перед каждым батчем.
 *
 * Критерий: для каждого упражнения, урока и размера батча с p̂ ∈ (0.01, 0.99)
 * `|p₁ − p₂| / √(p̂(1−p̂)(1/n₁ + 1/n₂)) ≤ 4.5`; вне этого диапазона частоты
 * не расходятся более чем на 0.03; носители (множества размеров батча) равны
 * с точностью до размеров реже 1%. Три фиксированных seed, все обязаны
 * проходить. Rust и TS используют разные ГСЧ и разные алгоритмы выборки
 * (A-ExpJ против A-Res), поэтому сверяется распределение, не потоки чисел.
 */
import type { UnitId } from '@dolphy-app/engine-contract';
import { describe, expect, it } from 'vitest';
import { readGoldenJsonl } from './helpers/golden.ts';
import { createWorld } from './helpers/world.ts';
import type { World, WorldCourseSpec } from './helpers/world.ts';

interface GoldenAttempt {
  exerciseId: UnitId;
  score: 1 | 2 | 3 | 4 | 5;
  agoMs: number;
}

interface L4Case {
  id: string;
  library: { courses: WorldCourseSpec[] };
  blacklist: UnitId[];
  options: { batchSize?: number; maxLessonsInProgress?: number };
  attempts: GoldenAttempt[];
  batches: number;
  expect: {
    batchSizes: Record<string, number>;
    exerciseCounts: Record<UnitId, number>;
    lessonCounts: Record<UnitId, number>;
  };
}

interface L4Header {
  nowMs: number;
}

const fixture = readGoldenJsonl<L4Header, L4Case>('l4.jsonl');

const SEEDS = [20260929, 7, 1234567];
const TS_BATCHES = 5000;
const Z_LIMIT = 4.5;
const EXTREME_TOLERANCE = 0.03;
const SUPPORT_FLOOR = 0.01;

const buildWorld = (golden: L4Case, seed: number) => {
  const { batchSize, maxLessonsInProgress } = golden.options;
  const world = createWorld({
    courses: golden.library.courses,
    precision: 'f32',
    startMs: fixture.nowMs,
    seed,
    options: {
      ...(batchSize === undefined ? {} : { batchSize }),
      ...(maxLessonsInProgress === undefined ? {} : { maxLessonsInProgress }),
    },
  });
  for (const id of golden.blacklist) world.blacklist.add(id);
  for (const { exerciseId, score, agoMs } of golden.attempts) {
    world.record(exerciseId, score, {
      atMs: fixture.nowMs - agoMs,
      noteSession: false,
    });
  }
  return world;
};

interface Frequencies {
  batchSizes: Map<string, number>;
  exercises: Map<UnitId, number>;
  lessons: Map<UnitId, number>;
}

const increment = <K>(map: Map<K, number>, key: K) => {
  map.set(key, (map.get(key) ?? 0) + 1);
};

const runBatches = (world: World, batches: number): Frequencies => {
  const frequencies: Frequencies = {
    batchSizes: new Map(),
    exercises: new Map(),
    lessons: new Map(),
  };
  for (let i = 0; i < batches; i++) {
    world.session.reset();
    const manifests = world.scheduler.getExerciseBatch();
    increment(frequencies.batchSizes, String(manifests.length));
    const lessons = new Set<UnitId>();
    for (const manifest of manifests) {
      increment(frequencies.exercises, manifest.id);
      lessons.add(manifest.lesson_id);
    }
    for (const lessonId of lessons) increment(frequencies.lessons, lessonId);
  }
  return frequencies;
};

/** Отклонения двух частот; пустой список — распределения согласованы. */
const compareCounts = (
  label: string,
  rust: Readonly<Record<string, number>>,
  rustBatches: number,
  ts: ReadonlyMap<string, number>,
  tsBatches: number,
) => {
  const problems: string[] = [];
  const keys = new Set([...Object.keys(rust), ...ts.keys()]);
  for (const key of keys) {
    const p1 = (rust[key] ?? 0) / rustBatches;
    const p2 = (ts.get(key) ?? 0) / tsBatches;
    const pooled =
      ((rust[key] ?? 0) + (ts.get(key) ?? 0)) / (rustBatches + tsBatches);
    if (pooled > SUPPORT_FLOOR && pooled < 1 - SUPPORT_FLOOR) {
      const se = Math.sqrt(
        pooled * (1 - pooled) * (1 / rustBatches + 1 / tsBatches),
      );
      const z = Math.abs(p1 - p2) / se;
      if (z > Z_LIMIT) {
        problems.push(
          `${label} ${key}: rust ${p1.toFixed(4)}, ts ${p2.toFixed(4)}, z ${z.toFixed(2)}`,
        );
      }
    } else if (Math.abs(p1 - p2) > EXTREME_TOLERANCE) {
      problems.push(
        `${label} ${key}: rust ${p1.toFixed(4)}, ts ${p2.toFixed(4)} (крайняя частота)`,
      );
    }
  }
  return problems;
};

describe('L4: частоты попадания в батч совпадают с Rust', () => {
  it('fixture содержит не менее пяти состояний, у каждого есть выборка со случайностью', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(5);
    for (const golden of fixture.cases) {
      const random = Object.values(golden.expect.exerciseCounts).filter(
        (count) => count > 0 && count < golden.batches,
      );
      expect(random.length, golden.id).toBeGreaterThan(0);
    }
  });

  describe.each(fixture.cases.map((golden) => [golden.id, golden] as const))(
    '%s',
    (_id, golden) => {
      it.each(SEEDS)('seed %i', { timeout: 120_000 }, (seed) => {
        const world = buildWorld(golden, seed);
        const ts = runBatches(world, TS_BATCHES);
        const problems = [
          ...compareCounts(
            'размер батча',
            golden.expect.batchSizes,
            golden.batches,
            ts.batchSizes,
            TS_BATCHES,
          ),
          ...compareCounts(
            'упражнение',
            golden.expect.exerciseCounts,
            golden.batches,
            ts.exercises,
            TS_BATCHES,
          ),
          ...compareCounts(
            'урок',
            golden.expect.lessonCounts,
            golden.batches,
            ts.lessons,
            TS_BATCHES,
          ),
        ];
        expect(problems).toEqual([]);
      });
    },
  );
});
