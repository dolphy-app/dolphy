/**
 * Бюджет NF1 для `getBatch` на библиотеках 1 500 и 3 000 уроков (engine-ts.md
 * §2: тёплый p95 < 100 мс, холодный < 500 мс). Запуск: `pnpm -F @spirula-app/engine
 * bench`. Проект отдельный: в `pnpm test` не входит, тесты советуют и падают
 * только при превышении бюджета NF1.
 *
 * Состояние ученика — FSRS-скорер (продукция) и журнал попыток в памяти:
 * «полностью освоенный граф» (обход упирается в весь граф, худший случай
 * Rust: 54 мс на первый батч) и «середина обучения» (освоена первая половина
 * уроков каждого курса).
 */
import { generateLibrary } from '@spirula-app/testkit';
import { describe, expect, it } from 'vitest';
import { type World, createWorld } from '../scheduler/helpers/world.ts';
import type { WorldCourseSpec } from '../scheduler/helpers/world.ts';

const COURSES = 10;
const EXERCISES_PER_LESSON = 4;
const WARM_BATCHES = 300;
const NF1_WARM_P95_MS = 100;
const NF1_COLD_MS = 500;
const DAY_MS = 86_400_000;

const buildCourses = (lessonsTotal: number): WorldCourseSpec[] => {
  const library = generateLibrary({
    courses: COURSES,
    lessonsPerCourse: lessonsTotal / COURSES,
    exercisesPerLesson: EXERCISES_PER_LESSON,
    seed: 20260929,
  });
  return library.courses.map((course) => ({
    id: course.id,
    lessons: library.lessons
      .filter((lesson) => lesson.course_id === course.id)
      .map((lesson) => ({
        id: lesson.id,
        dependencies: lesson.dependencies,
        exercises: library.exercises
          .filter((exercise) => exercise.lesson_id === lesson.id)
          .map((exercise) => exercise.id),
      })),
  }));
};

/** Три попытки на упражнение в последние трое суток: гейт (≥ 1.8 попыток) пройден. */
const master = (world: World, lessonIds: readonly string[]) => {
  const now = world.clock.now();
  for (const lessonId of lessonIds) {
    const exercises = world.library.graph.getLessonExercises(lessonId) ?? [];
    for (let round = 0; round < 3; round++) {
      const atMs = now - (3 - round) * DAY_MS;
      for (const exerciseId of exercises) {
        world.record(exerciseId, 5, { atMs });
      }
    }
  }
};

const percentile = (sorted: readonly number[], fraction: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ??
  0;

const timed = (run: () => unknown) => {
  const start = performance.now();
  run();
  return performance.now() - start;
};

const measure = (world: World) => {
  const cold = timed(() => world.getBatch());
  const warm = Array.from({ length: WARM_BATCHES }, () =>
    timed(() => world.getBatch()),
  ).sort((a, b) => a - b);
  return {
    coldMs: cold,
    warmP50Ms: percentile(warm, 0.5),
    warmP95Ms: percentile(warm, 0.95),
    warmMaxMs: warm.at(-1) ?? 0,
  };
};

const report = (title: string, numbers: ReturnType<typeof measure>) => {
  const fixed = Object.fromEntries(
    Object.entries(numbers).map(([key, value]) => [
      key,
      Number(value.toFixed(2)),
    ]),
  );
  console.log(`[bench] ${title}`, JSON.stringify(fixed));
};

describe.each([1500, 3000])(
  'NF1: getBatch, %i уроков × 4 упражнения',
  (lessons) => {
    const courses = buildCourses(lessons);
    const lessonIdsOf = (world: World) =>
      [...world.library.lessons.keys()].sort();

    it('полностью освоенный граф', () => {
      const world = createWorld({ courses, scorer: 'fsrs', seed: 1 });
      master(world, lessonIdsOf(world));
      const reached = new Set(
        world.scheduler.getInitialCandidates().map((c) => c.lessonId),
      );
      expect(reached.size).toBeGreaterThan(lessons * 0.9);
      const numbers = measure(world);
      report(`${lessons} уроков, всё освоено`, numbers);
      expect(numbers.coldMs).toBeLessThan(NF1_COLD_MS);
      expect(numbers.warmP95Ms).toBeLessThan(NF1_WARM_P95_MS);
    });

    it('середина обучения: освоена первая половина уроков курсов', () => {
      const world = createWorld({ courses, scorer: 'fsrs', seed: 2 });
      const half = lessonIdsOf(world).filter((lessonId) => {
        const index = Number(lessonId.split('_').at(-1));
        return index < lessons / COURSES / 2;
      });
      master(world, half);
      const numbers = measure(world);
      report(`${lessons} уроков, освоена половина`, numbers);
      expect(numbers.coldMs).toBeLessThan(NF1_COLD_MS);
      expect(numbers.warmP95Ms).toBeLessThan(NF1_WARM_P95_MS);
    });

    it('после записи попытки кэш упражнения сброшен, батч остаётся в бюджете', () => {
      const world = createWorld({ courses, scorer: 'fsrs', seed: 3 });
      master(world, lessonIdsOf(world));
      world.getBatch();
      const durations = Array.from({ length: 100 }, () => {
        const [exerciseId] = world.getBatch();
        world.record(exerciseId as string, 4);
        return timed(() => world.getBatch());
      }).sort((a, b) => a - b);
      const p95 = percentile(durations, 0.95);
      console.log(
        `[bench] ${lessons} уроков, батч после попытки: p95 ${p95.toFixed(2)} мс`,
      );
      expect(p95).toBeLessThan(NF1_WARM_P95_MS);
    });
  },
);

it('bench-конфигурация подключена: тест сообщает окружение', () => {
  console.log(
    `[bench] node ${process.version} ${process.platform}-${process.arch}`,
  );
  expect(WARM_BATCHES).toBeGreaterThan(0);
});
