/**
 * Общие хелперы интеграционных тестов планировщика: аналог
 * `test_utils::{TestCourse, TestLesson, all_test_exercises, TraneSimulation,
 * assert_simulation_scores, RandomCourseLibrary}` Trane.
 *
 * Отличия от Rust (контракт порта): время — `FakeClock` мира вместо
 * `Utc::now`; вместо `TempDir` и загрузчика библиотека собирается в памяти
 * (`createWorld`); `RandomCourseLibrary` использует сидируемый `Rng`, а не
 * `rand::rng()`, поэтому библиотека воспроизводима.
 */
import type {
  ExerciseFilterDto,
  Grade,
  UnitId,
} from '@spirula-app/engine-contract';
import { expect } from 'vitest';
import type { Rng } from '../../../src/ports/index.ts';
import type {
  World,
  WorldCourseSpec,
  WorldLessonSpec,
} from '../helpers/world.ts';

/** Seed-ы, на которых каждый тест обязан проходить (планировщик случайный). */
export const SEEDS: readonly number[] = [7, 1234, 987_654];

/**
 * Прогоняет тело теста на каждом seed; при падении добавляет seed в
 * сообщение, чтобы падение воспроизводилось.
 */
export const forEachSeed = (run: (seed: number) => void) => {
  for (const seed of SEEDS) {
    try {
      run(seed);
    } catch (error) {
      if (error instanceof Error) {
        error.message = `[seed ${seed}] ${error.message}`;
      }
      throw error;
    }
  }
};

/** Полные id вида `курс`, `курс::урок`, `курс::урок::упражнение` (`TestId`). */
export const testId = (course: number, lesson?: number, exercise?: number) =>
  [course, lesson, exercise]
    .filter((part): part is number => part !== undefined)
    .join('::');

type LessonFields = Partial<Omit<WorldLessonSpec, 'id'>>;
type CourseFields = Partial<Omit<WorldCourseSpec, 'id' | 'lessons'>>;

/** `TestLesson`: по умолчанию 10 упражнений (как в библиотеках Trane). */
export const lesson = (
  id: UnitId,
  fields: LessonFields = {},
): WorldLessonSpec => ({ id, exercises: 10, ...fields });

/** `TestCourse`. */
export const course = (
  id: UnitId,
  lessons: WorldLessonSpec[],
  fields: CourseFields = {},
): WorldCourseSpec => ({ id, ...fields, lessons });

const exerciseIdsOf = (spec: WorldLessonSpec) =>
  typeof spec.exercises === 'number'
    ? Array.from({ length: spec.exercises }, (_, i) => `${spec.id}::${i}`)
    : spec.exercises;

/** `all_test_exercises`: id всех упражнений библиотеки в порядке описания. */
export const allTestExercises = (courses: readonly WorldCourseSpec[]) =>
  courses.flatMap((c) => c.lessons.flatMap(exerciseIdsOf));

/** `TestId::exercise_in_course`: курс — первый сегмент id упражнения. */
export const exerciseInCourse = (exerciseId: UnitId, courseId: UnitId) =>
  exerciseId.startsWith(`${courseId.split('::')[0]}::`);

/** `TestId::exercise_in_lesson`: совпадают первые два сегмента. */
export const exerciseInLesson = (exerciseId: UnitId, lessonId: UnitId) => {
  const [courseId, lessonIndex] = lessonId.split('::');
  return exerciseId.startsWith(`${courseId}::${lessonIndex}::`);
};

/** История ответов симуляции: упражнение → оценки в порядке ответа. */
export type AnswerHistory = Map<UnitId, Grade[]>;

export interface SimulationOptions {
  /** Сколько упражнений покажет ученик (как `num_exercises`). */
  exercises: number;
  /** Оценка упражнения; `null` — пропустить (не записывать попытку). */
  answer: (exerciseId: UnitId) => Grade | null;
  filter?: ExerciseFilterDto;
  /** Юниты, добавляемые в blacklist перед запуском. */
  blacklist?: readonly UnitId[];
  /** Сколько мс `clock` уходит на один ответ; 0 — время стоит. */
  stepMs?: number;
}

export const DEFAULT_STEP_MS = 1000;

/** `|_| Some(MasteryScore::…)`. */
export const always = (grade: Grade) => (): Grade => grade;

/**
 * `TraneSimulation::run_simulation`: пока не показано `exercises`
 * упражнений, берёт батч (пустой — выход), выдаёт упражнения с конца батча
 * и записывает попытки через `world.record`. Возвращает историю ответов
 * этого запуска.
 */
export const simulate = (
  world: World,
  {
    exercises,
    answer,
    filter,
    blacklist = [],
    stepMs = DEFAULT_STEP_MS,
  }: SimulationOptions,
): AnswerHistory => {
  for (const unitId of blacklist) world.blacklist.add(unitId);
  const history: AnswerHistory = new Map();
  let batch: UnitId[] = [];
  for (let completed = 0; completed < exercises; completed++) {
    if (batch.length === 0) {
      batch = world.getBatch(filter);
      // пустой батч дважды подряд — бесконечный цикл; как в Rust, выходим
      if (batch.length === 0) break;
    }
    const exerciseId = batch.pop() as UnitId;
    const grade = answer(exerciseId);
    if (grade === null) continue;
    world.record(exerciseId, grade);
    const grades = history.get(exerciseId) ?? [];
    grades.push(grade);
    history.set(exerciseId, grades);
    world.clock.advance(stepMs);
  }
  return history;
};

/**
 * `assert_simulation_scores`: последние (до 10) попытки мира совпадают с
 * оценками симуляции, от новых к старым. Как `zip` в Rust, сравнивает
 * только общий префикс: у мира могут быть попытки прошлых запусков.
 */
export const assertSimulationScores = (
  world: World,
  exerciseId: UnitId,
  history: AnswerHistory,
) => {
  const trials = world.attempts.getTrials(exerciseId, 10);
  const grades = [...(history.get(exerciseId) ?? [])].reverse();
  const common = Math.min(trials.length, grades.length);
  expect(
    trials.slice(0, common).map((trial) => trial.score),
    `scores of ${exerciseId}`,
  ).toEqual(grades.slice(0, common));
};

/**
 * Для каждого упражнения из `allIds`: если `expected` — оно должно быть в
 * истории (и оценки совпадают с миром), иначе — не должно.
 */
export const assertScheduledExactly = (
  world: World,
  history: AnswerHistory,
  allIds: readonly UnitId[],
  expected: (exerciseId: UnitId) => boolean,
) => {
  for (const exerciseId of allIds) {
    if (expected(exerciseId)) {
      expect(
        history.has(exerciseId),
        `exercise ${exerciseId} should have been scheduled`,
      ).toBe(true);
      assertSimulationScores(world, exerciseId, history);
    } else {
      expect(
        history.has(exerciseId),
        `exercise ${exerciseId} should not have been scheduled`,
      ).toBe(false);
    }
  }
};

/** Только «должно быть запланировано»: упражнения вне `expected` не проверяются. */
export const assertScheduled = (
  world: World,
  history: AnswerHistory,
  allIds: readonly UnitId[],
  expected: (exerciseId: UnitId) => boolean,
) => {
  for (const exerciseId of allIds) {
    if (!expected(exerciseId)) continue;
    expect(
      history.has(exerciseId),
      `exercise ${exerciseId} should have been scheduled`,
    ).toBe(true);
    assertSimulationScores(world, exerciseId, history);
  }
};

/** Только «не должно быть запланировано». */
export const assertNotScheduled = (
  history: AnswerHistory,
  allIds: readonly UnitId[],
  forbidden: (exerciseId: UnitId) => boolean,
) => {
  for (const exerciseId of allIds) {
    if (!forbidden(exerciseId)) continue;
    expect(
      history.has(exerciseId),
      `exercise ${exerciseId} should not have been scheduled`,
    ).toBe(false);
  }
};

export interface RandomLibraryOptions {
  numCourses: number;
  /** Все диапазоны включают границы, как в `RandomCourseLibrary`. */
  courseDependencies: readonly [number, number];
  lessonsPerCourse: readonly [number, number];
  lessonDependencies: readonly [number, number];
  exercisesPerLesson: readonly [number, number];
}

const rangeInclusive = (rng: Rng, [lo, hi]: readonly [number, number]) =>
  rng.range(lo, hi + 1);

/**
 * `RandomCourseLibrary::generate_library`: зависимости курса — курсы с
 * меньшим номером, зависимости урока — уроки того же курса с меньшим
 * номером (граф ацикличен); уроки могут быть без упражнений, курсы — без
 * уроков.
 */
export const randomCourseSpecs = (
  rng: Rng,
  options: RandomLibraryOptions,
): WorldCourseSpec[] => {
  const courses: WorldCourseSpec[] = [];
  for (let courseIndex = 0; courseIndex < options.numCourses; courseIndex++) {
    const lessons: WorldLessonSpec[] = [];
    const lessonCount = rangeInclusive(rng, options.lessonsPerCourse);
    for (let lessonIndex = 0; lessonIndex < lessonCount; lessonIndex++) {
      const exercises = rangeInclusive(rng, options.exercisesPerLesson);
      const dependencies: UnitId[] = [];
      const wanted = rangeInclusive(rng, options.lessonDependencies);
      for (let i = 0; i < Math.min(wanted, lessonIndex); i++) {
        const dependency = testId(courseIndex, rng.range(0, lessonIndex));
        if (!dependencies.includes(dependency)) dependencies.push(dependency);
      }
      lessons.push(
        lesson(testId(courseIndex, lessonIndex), { dependencies, exercises }),
      );
    }
    const courseDependencies: UnitId[] = [];
    const wantedCourses = rangeInclusive(rng, options.courseDependencies);
    for (let i = 0; i < Math.min(wantedCourses, courseIndex); i++) {
      const dependency = testId(rng.range(0, courseIndex));
      if (!courseDependencies.includes(dependency)) {
        courseDependencies.push(dependency);
      }
    }
    courses.push(
      course(testId(courseIndex), lessons, {
        dependencies: courseDependencies,
      }),
    );
  }
  return courses;
};
