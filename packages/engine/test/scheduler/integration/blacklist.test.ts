/**
 * Порт `tests/blacklist_tests.rs` Trane (6 тестов): планировщик не выдаёт
 * упражнения из blacklist (курсы, уроки, упражнения), а кэш оценок
 * инвалидируется при изменении blacklist.
 *
 * Отличия от Rust: библиотека собирается в памяти; blacklist — изменяемый
 * `world.blacklist`; `set_scheduler_options` — `world.options.set`; тесты
 * выполняются на нескольких seed (`forEachSeed`).
 */
import { describe, expect, it } from 'vitest';
import { createWorld } from '../helpers/world.ts';
import type { WorldCourseSpec } from '../helpers/world.ts';
import {
  allTestExercises,
  always,
  assertNotScheduled,
  assertScheduled,
  assertScheduledExactly,
  course,
  exerciseInCourse,
  exerciseInLesson,
  forEachSeed,
  lesson,
  simulate,
  testId,
} from './helpers.ts';

/** Библиотека `blacklist_tests.rs`: 6 курсов. */
const LIBRARY: WorldCourseSpec[] = [
  course('0', [lesson('0::0'), lesson('0::1', { dependencies: ['0::0'] })]),
  course('1', [lesson('1::0'), lesson('1::1', { dependencies: ['1::0'] })], {
    dependencies: ['0'],
  }),
  course(
    '2',
    [
      lesson('2::0'),
      lesson('2::1', { dependencies: ['2::0'] }),
      lesson('2::2', { dependencies: ['2::1'] }),
    ],
    { dependencies: ['0'] },
  ),
  course('3', [lesson('3::0'), lesson('3::1', { dependencies: ['3::0'] })], {
    dependencies: ['1'],
  }),
  course('4', [lesson('4::0'), lesson('4::1', { dependencies: ['4::0'] })], {
    dependencies: ['0'],
  }),
  course('5', [lesson('5::0'), lesson('5::1', { dependencies: ['5::0'] })], {
    dependencies: ['0'],
  }),
];

const ALL_EXERCISES = allTestExercises(LIBRARY);

const exercisesOfLesson = (course: number, lessonIndex: number) =>
  Array.from({ length: 10 }, (_, i) => testId(course, lessonIndex, i));

describe('blacklist', () => {
  it('avoid_scheduling_courses_in_blacklist: курсы из blacklist не планируются', () => {
    forEachSeed((seed) => {
      const world = createWorld({ courses: LIBRARY, seed });
      const blacklist = ['0', '3'];
      const history = simulate(world, {
        exercises: 500,
        answer: always(5),
        blacklist,
      });
      assertScheduledExactly(
        world,
        history,
        ALL_EXERCISES,
        (id) => !blacklist.some((courseId) => exerciseInCourse(id, courseId)),
      );
    });
  });

  it('avoid_scheduling_lessons_in_blacklist: уроки из blacklist не планируются', () => {
    forEachSeed((seed) => {
      const world = createWorld({ courses: LIBRARY, seed });
      const blacklist = ['0::1', '3::0'];
      const history = simulate(world, {
        exercises: 500,
        answer: always(5),
        blacklist,
      });
      assertScheduledExactly(
        world,
        history,
        ALL_EXERCISES,
        (id) => !blacklist.some((lessonId) => exerciseInLesson(id, lessonId)),
      );
    });
  });

  it('avoid_scheduling_lessons_in_blacklist_with_course_filter: фильтр курса не возвращает упражнения заблокированных уроков', () => {
    forEachSeed((seed) => {
      const world = createWorld({ courses: LIBRARY, seed });
      const lessonBlacklist = ['0::1', '3::0'];
      const selectedCourses = ['0', '3'];
      const history = simulate(world, {
        exercises: 500,
        answer: always(5),
        blacklist: lessonBlacklist,
        filter: {
          UnitFilter: { CourseFilter: { course_ids: selectedCourses } },
        },
      });
      assertScheduledExactly(
        world,
        history,
        ALL_EXERCISES,
        (id) =>
          selectedCourses.some((courseId) => exerciseInCourse(id, courseId)) &&
          !lessonBlacklist.some((lessonId) => exerciseInLesson(id, lessonId)),
      );
    });
  });

  it('avoid_scheduling_exercises_in_blacklist: упражнения из blacklist не планируются', () => {
    forEachSeed((seed) => {
      const world = createWorld({ courses: LIBRARY, seed });
      const blacklist = exercisesOfLesson(2, 1);
      const history = simulate(world, {
        exercises: 500,
        answer: always(5),
        blacklist,
      });
      assertScheduledExactly(
        world,
        history,
        ALL_EXERCISES,
        (id) => !blacklist.includes(id),
      );
    });
  });

  it('schedule_courses_with_many_blacklisted_units: заблокированные юниты не занимают max_lessons_in_progress', () => {
    forEachSeed((seed) => {
      const world = createWorld({ courses: LIBRARY, seed });
      // Регрессия: заблокированные юниты считались в лимит уроков «в работе»
      // и преждевременно обрывали поиск кандидатов.
      world.options.set({ maxLessonsInProgress: 5 });
      const blacklist = ['0', '1', '2', '3', '4'];
      const history = simulate(world, {
        exercises: 500,
        answer: always(5),
        blacklist,
      });
      assertScheduledExactly(
        world,
        history,
        ALL_EXERCISES,
        (id) => !blacklist.some((courseId) => exerciseInCourse(id, courseId)),
      );
    });
  });

  it('invalidate_cache_on_blacklist_update: кэш оценок сбрасывается при изменении blacklist', () => {
    forEachSeed((seed) => {
      const world = createWorld({ courses: LIBRARY, seed });
      const blacklist = [
        ...exercisesOfLesson(0, 0),
        ...exercisesOfLesson(0, 1),
      ];

      // Шаг 1: с blacklist и оценкой 5 планируется всё, кроме blacklist.
      let history = simulate(world, {
        exercises: 500,
        answer: always(5),
        blacklist,
      });
      assertScheduledExactly(
        world,
        history,
        ALL_EXERCISES,
        (id) => !blacklist.includes(id),
      );

      // Шаг 2: убираем юниты из blacklist и ставим везде 1. Первый урок 0::0
      // планируется, а зависящие от него уроки и курсы — нет.
      for (const exerciseId of blacklist) world.blacklist.remove(exerciseId);
      history = simulate(world, { exercises: 500, answer: always(1) });
      const blockedLessons = [
        '0::1',
        '1::0',
        '1::1',
        '2::0',
        '2::1',
        '2::2',
        '3::0',
        '3::1',
      ];
      assertScheduled(world, history, ALL_EXERCISES, (id) =>
        exerciseInLesson(id, '0::0'),
      );
      assertNotScheduled(history, ALL_EXERCISES, (id) =>
        blockedLessons.some((lessonId) => exerciseInLesson(id, lessonId)),
      );

      // Шаг 3: снова добавляем те же упражнения — они не планируются.
      history = simulate(world, {
        exercises: 500,
        answer: always(5),
        blacklist,
      });
      expect(
        [...history.keys()].filter((id) => blacklist.includes(id)),
      ).toEqual([]);
    });
  });
});
