/**
 * Порт `tests/superseded_tests.rs` Trane (5 тестов): планировщик не выдаёт
 * упражнения вытесненных (superseded) курсов и уроков, пока вытесняющий
 * юнит освоен, и возвращает их, когда оценка вытесняющего падает; цепочки
 * вытеснения и игнорирование вытесненных упражнений в оценке курса.
 *
 * Отличия от Rust: библиотека собирается в памяти; время — `FakeClock`
 * (между ответами проходит по секунде, в Rust время почти не идёт); тесты
 * выполняются на нескольких seed (`forEachSeed`).
 * Как и в оригинале, в `scheduler_respects_superseded_lessons` финальная
 * проверка идёт по всему курсу `2` (`exercise_in_course(2::0)`).
 */
import { describe, it } from 'vitest';
import type { Grade } from '@spirula-app/engine-contract';
import { createWorld } from '../helpers/world.ts';
import type { World, WorldCourseSpec } from '../helpers/world.ts';
import {
  allTestExercises,
  always,
  assertNotScheduled,
  assertScheduled,
  course,
  exerciseInCourse,
  exerciseInLesson,
  forEachSeed,
  lesson,
  simulate,
} from './helpers.ts';

/** Библиотека `superseded_tests.rs`: цепочки вытеснения курсов и уроков. */
const LIBRARY: WorldCourseSpec[] = [
  course('0', [lesson('0::0'), lesson('0::1', { dependencies: ['0::0'] })]),
  course('1', [lesson('1::0'), lesson('1::1', { dependencies: ['1::0'] })], {
    dependencies: ['0'],
    superseded: ['0'],
  }),
  course('2', [
    lesson('2::0'),
    lesson('2::1', { dependencies: ['2::0'] }),
    lesson('2::2', { dependencies: ['2::1'], superseded: ['2::0'] }),
  ]),
  course('3', [lesson('3::0'), lesson('3::1', { dependencies: ['3::0'] })]),
  course('4', [lesson('4::0'), lesson('4::1', { dependencies: ['4::0'] })], {
    dependencies: ['3'],
    superseded: ['3'],
  }),
  course('5', [lesson('5::0'), lesson('5::1', { dependencies: ['5::0'] })], {
    dependencies: ['4'],
    superseded: ['4'],
  }),
  course('6', [
    lesson('6::0'),
    lesson('6::1', { dependencies: ['6::0'], superseded: ['6::0'] }),
    lesson('6::2', { dependencies: ['6::1'], superseded: ['6::1'] }),
  ]),
  course('7', [lesson('7::0')], { dependencies: ['6'] }),
];

const ALL_EXERCISES = allTestExercises(LIBRARY);

/** Оценка 1 для упражнений с указанным префиксом id, иначе 5. */
const lowFor =
  (...prefixes: string[]) =>
  (exerciseId: string): Grade =>
    prefixes.some((prefix) => exerciseId.startsWith(prefix)) ? 1 : 5;

/**
 * Общий разгон: (1) при оценке 5 планируется всё, (2) повторный прогон
 * не трогает вытесненный юнит.
 */
const warmUp = (
  world: World,
  exercises: number,
  isSuperseded: (id: string) => boolean,
) => {
  const first = simulate(world, { exercises, answer: always(5) });
  assertScheduled(world, first, ALL_EXERCISES, () => true);

  const second = simulate(world, { exercises, answer: always(5) });
  assertNotScheduled(second, ALL_EXERCISES, isSuperseded);
};

describe('вытеснение (superseded)', () => {
  it('scheduler_respects_superseded_courses: вытесненный курс не планируется, пока вытесняющий освоен', () => {
    forEachSeed((seed) => {
      const world = createWorld({ courses: LIBRARY, seed });
      warmUp(world, 2000, (id) => exerciseInCourse(id, '0'));

      // Вытесняющий курс 1 получает оценку 1 — вытесненный курс 0 снова
      // планируется.
      const history = simulate(world, {
        exercises: 2000,
        answer: lowFor('1::'),
      });
      assertScheduled(world, history, ALL_EXERCISES, (id) =>
        exerciseInCourse(id, '0'),
      );
    });
  });

  it('scheduler_respects_superseded_lessons: вытесненный урок не планируется, пока вытесняющий освоен', () => {
    forEachSeed((seed) => {
      const world = createWorld({ courses: LIBRARY, seed });
      warmUp(world, 2500, (id) => exerciseInLesson(id, '2::0'));

      // Вытесняющий урок 2::2 получает оценку 1 — вытесненный 2::0 снова
      // планируется (как в оригинале, проверка идёт по курсу 2 целиком).
      const history = simulate(world, {
        exercises: 2500,
        answer: lowFor('2::2::'),
      });
      assertScheduled(world, history, ALL_EXERCISES, (id) =>
        exerciseInCourse(id, '2'),
      );
    });
  });

  it('scheduler_respects_superseded_course_chain: цепочка вытеснения курсов 3 ← 4 ← 5', () => {
    forEachSeed((seed) => {
      const world = createWorld({ courses: LIBRARY, seed });
      warmUp(
        world,
        2000,
        (id) => exerciseInCourse(id, '3') || exerciseInCourse(id, '4'),
      );

      // Оценка 1 в конце цепочки (курс 5): возвращается курс 4, курс 3 — нет.
      let history = simulate(world, {
        exercises: 2000,
        answer: lowFor('5::'),
      });
      assertScheduled(world, history, ALL_EXERCISES, (id) =>
        exerciseInCourse(id, '4'),
      );
      assertNotScheduled(history, ALL_EXERCISES, (id) =>
        exerciseInCourse(id, '3'),
      );

      // Оценка 1 в курсах 4 и 5: возвращается и курс 3.
      history = simulate(world, {
        exercises: 2000,
        answer: lowFor('4::', '5::'),
      });
      assertScheduled(world, history, ALL_EXERCISES, (id) =>
        exerciseInCourse(id, '3'),
      );
    });
  });

  it('scheduler_respects_superseded_lesson_chain: цепочка вытеснения уроков 6::0 ← 6::1 ← 6::2', () => {
    forEachSeed((seed) => {
      const world = createWorld({ courses: LIBRARY, seed });
      warmUp(
        world,
        2000,
        (id) => exerciseInLesson(id, '6::0') || exerciseInLesson(id, '6::1'),
      );

      // Оценка 1 в конце цепочки (6::2): возвращается 6::1, 6::0 — нет.
      let history = simulate(world, {
        exercises: 2000,
        answer: lowFor('6::2::'),
      });
      assertScheduled(world, history, ALL_EXERCISES, (id) =>
        exerciseInLesson(id, '6::1'),
      );
      assertNotScheduled(history, ALL_EXERCISES, (id) =>
        exerciseInLesson(id, '6::0'),
      );

      // Оценка 1 в 6::1 и 6::2: возвращается и 6::0.
      history = simulate(world, {
        exercises: 2000,
        answer: lowFor('6::1', '6::2'),
      });
      assertScheduled(world, history, ALL_EXERCISES, (id) =>
        exerciseInLesson(id, '6::0'),
      );
    });
  });

  it('scheduler_ignores_superseded_exercises: вытесненные упражнения не портят оценку курса для зависимых', () => {
    forEachSeed((seed) => {
      const world = createWorld({ courses: LIBRARY, seed });

      // Оценка 1 только в вытесненных уроках 6::0 и 6::1 понижает среднюю
      // оценку курса 6.
      const superseded = ['6::0', '6::1'];
      let history = simulate(world, {
        exercises: 2000,
        answer: always(1),
        filter: { UnitFilter: { LessonFilter: { lesson_ids: superseded } } },
      });
      assertScheduled(world, history, ALL_EXERCISES, (id) =>
        superseded.some((lessonId) => exerciseInLesson(id, lessonId)),
      );

      // Высокая оценка в вытесняющем уроке 6::2 поднимает оценку курса и
      // вытесняет предыдущие уроки.
      history = simulate(world, {
        exercises: 2000,
        answer: always(5),
        filter: { UnitFilter: { LessonFilter: { lesson_ids: ['6::2'] } } },
      });
      assertScheduled(world, history, ALL_EXERCISES, (id) =>
        exerciseInLesson(id, '6::2'),
      );

      // Без фильтра зависимый курс 7 достижим: вытесненные упражнения при
      // оценке курса игнорируются.
      history = simulate(world, { exercises: 2000, answer: always(5) });
      assertScheduled(world, history, ALL_EXERCISES, (id) =>
        exerciseInCourse(id, '7'),
      );
    });
  });
});
