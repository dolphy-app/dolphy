/**
 * Интеграционные тесты планировщика на симуляции ученика: порт
 * `tests/basic_tests.rs` Trane (22 теста) и `large_tests.rs::
 * all_exercises_scheduled_random`.
 *
 * Отличия от Rust (намеренные, по контракту порта):
 * - библиотека собирается в памяти (`createWorld`), а не пишется на диск;
 * - время — `FakeClock` мира (`schedule_study_session`: старт сессии берётся
 *   из `world.clock`, а не из `Utc::now`);
 * - планировщик случайный, поэтому каждый тест выполняется на нескольких
 *   seed (`forEachSeed`) и проверяет множества «появилось / не появилось»;
 * - `set_scheduler_options` / `reset_scheduler_options` идут через единый
 *   холдер опций (`world.options`) и дополнительно проверяют эффект на батч;
 * - `ignored_paths` (загрузчик) и `serialized_course_library` (сериализация
 *   библиотеки удалена из порта) не портируются: к планировщику отношения
 *   не имеют и покрыты в тестах загрузчика/артефакта.
 */
import { describe, expect, it } from 'vitest';
import type { ExerciseFilterDto } from '@dolphy-app/engine-contract';
import { createSeededRng } from '@dolphy-app/testkit';
import { DEFAULT_SCHEDULER_OPTIONS } from '../../../src/scheduler/index.ts';
import { createWorld } from '../helpers/world.ts';
import type { WorldCourseSpec } from '../helpers/world.ts';
import {
  allTestExercises,
  always,
  assertNotScheduled,
  assertScheduledExactly,
  course,
  exerciseInCourse,
  exerciseInLesson,
  forEachSeed,
  lesson,
  randomCourseSpecs,
  simulate,
} from './helpers.ts';

/** Библиотека `basic_tests.rs`: 9 курсов, есть «висячие» зависимости. */
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
  course('4', [
    lesson('4::0'),
    lesson('4::1', { dependencies: ['4::0', '2::1'] }),
    lesson('4::2', { dependencies: ['4::0'] }),
    lesson('4::3', { dependencies: ['4::2'] }),
  ]),
  course(
    '5',
    [
      lesson('5::0', { dependencies: ['4::1'] }),
      // зависит от несуществующего урока 3::3
      lesson('5::1', { dependencies: ['5::0', '3::3'] }),
    ],
    // зависит от несуществующего курса 3
    { dependencies: ['3', '4'] },
  ),
  course('6', [lesson('6::0'), lesson('6::1', { dependencies: ['6::0'] })], {
    dependencies: ['3'],
    encompassed: [['5::0', 0.5]],
  }),
  course(
    '7',
    [
      lesson('7::0', { dependencies: ['0'] }),
      // зависит от несуществующего урока 6::11
      lesson('7::1', { dependencies: ['0::0', '6::11'] }),
      // урок без упражнений
      lesson('7::2', {
        dependencies: ['7::1'],
        encompassed: [['7::0', 1]],
        exercises: 0,
      }),
    ],
    {
      metadata: {
        course_key_1: ['course_key_1:value_1'],
        course_key_2: ['course_key_2:value_1'],
      },
    },
  ),
  // курс без уроков
  course('8', [], { dependencies: ['7'] }),
  // курс без уроков и без зависимостей
  course('9', []),
];

const ALL_EXERCISES = allTestExercises(LIBRARY);

const createLibraryWorld = (seed: number) =>
  createWorld({ courses: LIBRARY, seed });

describe('запросы к библиотеке (не про планировщик)', () => {
  it('get_unit_ids: id курсов, уроков и упражнений', () => {
    const { library } = createLibraryWorld(1);
    const courseIds = library.getCourseIds();
    expect(courseIds).toEqual(['0', '1', '2', '4', '5', '6', '7', '8', '9']);

    for (const courseId of courseIds) {
      for (const lessonId of library.getLessonIds(courseId) ?? []) {
        expect(lessonId.startsWith(`${courseId}::`)).toBe(true);
        expect(lessonId.split('::')).toHaveLength(2);
        for (const exerciseId of library.getExerciseIds(lessonId) ?? []) {
          expect(exerciseId.startsWith(`${lessonId}::`)).toBe(true);
          expect(exerciseId.split('::')).toHaveLength(3);
        }
      }
    }
    // курсы без уроков и уроки без упражнений не имеют списков в графе
    expect(library.getLessonIds('8')).toBeUndefined();
    expect(library.getLessonIds('7')).toEqual(['7::0', '7::1', '7::2']);
    expect(library.getExerciseIds('7::2')).toBeUndefined();
    expect(library.getExerciseIds('0::0')).toHaveLength(10);
  });

  it('get_all_exercise_ids: упражнения курса, урока, упражнения, неизвестного юнита и всей библиотеки', () => {
    const { library } = createLibraryWorld(1);

    const ofCourse = library.getAllExerciseIds('0');
    expect(ofCourse).toHaveLength(20);
    for (const id of ofCourse) expect(id.startsWith('0::')).toBe(true);

    const ofLesson = library.getAllExerciseIds('0::0');
    expect(ofLesson).toHaveLength(10);
    for (const id of ofLesson) expect(id.startsWith('0::0::')).toBe(true);

    // упражнение возвращает само себя
    expect(library.getAllExerciseIds('0::0::0')).toEqual(['0::0::0']);
    // неизвестный юнит — пустой список
    expect(library.getAllExerciseIds('0::0::100')).toEqual([]);

    const all = library.getAllExerciseIds();
    expect(all).toHaveLength(ALL_EXERCISES.length);
    expect(new Set(all)).toEqual(new Set(ALL_EXERCISES));
  });

  it('get_matching_courses: курсы с префиксом', () => {
    const { library } = createLibraryWorld(1);
    const matching = library.getMatchingPrefix('0', 'Course');
    expect(matching).toEqual(new Set(['0']));
  });

  it('get_matching_lessons: уроки с префиксом', () => {
    const { library } = createLibraryWorld(1);
    const matching = library.getMatchingPrefix('0::0', 'Lesson');
    expect(matching).toEqual(new Set(['0::0']));
  });

  it('get_matching_exercises: упражнения с префиксом', () => {
    const { library } = createLibraryWorld(1);
    const matching = library.getMatchingPrefix('0::0::0', 'Exercise');
    expect(matching).toEqual(new Set(['0::0::0']));
  });

  it('get_matching_units: все юниты с префиксом (курс, 2 урока, 20 упражнений)', () => {
    const { library } = createLibraryWorld(1);
    const matching = library.getMatchingPrefix('0');
    expect(matching.size).toBe(23);
    expect(matching.has('0')).toBe(true);
    expect(matching.has('0::0')).toBe(true);
    expect(matching.has('0::0::0')).toBe(true);
  });
});

describe('планирование без фильтров', () => {
  it('all_exercises_scheduled: при оценке 5 планируются все упражнения', () => {
    forEachSeed((seed) => {
      const world = createLibraryWorld(seed);
      const history = simulate(world, {
        exercises: ALL_EXERCISES.length * 25,
        answer: always(5),
      });
      assertScheduledExactly(world, history, ALL_EXERCISES, () => true);
    });
  });

  it('bad_score_prevents_advancing: при оценке 1 дальше первых уроков не идёт', () => {
    forEachSeed((seed) => {
      const world = createLibraryWorld(seed);
      const history = simulate(world, { exercises: 200, answer: always(1) });
      const firstLessons = ['0::0', '4::0', '6::0'];
      assertScheduledExactly(world, history, ALL_EXERCISES, (id) =>
        firstLessons.some((lessonId) => exerciseInLesson(id, lessonId)),
      );
    });
  });
});

describe('фильтры курсов и уроков', () => {
  it('scheduler_respects_course_filter: только упражнения выбранных курсов', () => {
    forEachSeed((seed) => {
      const world = createLibraryWorld(seed);
      // Сначала открываем курс 4: он зависит от урока курса 2, и граница
      // фильтра не должна пересекаться.
      simulate(world, {
        exercises: 500,
        answer: always(5),
        filter: { UnitFilter: { CourseFilter: { course_ids: ['4'] } } },
      });

      const selected = ['2', '3']; // курса 3 нет
      const history = simulate(world, {
        exercises: 500,
        answer: always(5),
        filter: { UnitFilter: { CourseFilter: { course_ids: selected } } },
      });
      assertScheduledExactly(world, history, ALL_EXERCISES, (id) =>
        selected.some((courseId) => exerciseInCourse(id, courseId)),
      );
      for (const exerciseId of history.keys()) {
        expect(
          selected.some((courseId) => exerciseInCourse(exerciseId, courseId)),
          `exercise ${exerciseId} should be from a selected course`,
        ).toBe(true);
      }
    });
  });

  it('scheduler_respects_lesson_filter: только упражнения выбранных уроков', () => {
    forEachSeed((seed) => {
      const world = createLibraryWorld(seed);
      const selected = ['2::0', '4::1', '3::0']; // урока 3::0 нет
      const history = simulate(world, {
        exercises: 500,
        answer: always(5),
        filter: { UnitFilter: { LessonFilter: { lesson_ids: selected } } },
      });
      assertScheduledExactly(world, history, ALL_EXERCISES, (id) =>
        selected.some((lessonId) => exerciseInLesson(id, lessonId)),
      );
    });
  });
});

describe('review list', () => {
  const reviewListFilter: ExerciseFilterDto = {
    UnitFilter: 'ReviewListFilter',
  };

  it('schedule_exercises_in_review_list: упражнения из списка повторения', () => {
    forEachSeed((seed) => {
      const world = createLibraryWorld(seed);
      const reviewed = ['1::0::0', '2::1::7'];
      for (const unitId of reviewed) world.reviewList.add(unitId);
      const history = simulate(world, {
        exercises: 100,
        answer: always(5),
        filter: reviewListFilter,
      });
      assertScheduledExactly(world, history, ALL_EXERCISES, (id) =>
        reviewed.includes(id),
      );
    });
  });

  it('schedule_lessons_in_review_list: упражнения уроков из списка повторения', () => {
    forEachSeed((seed) => {
      const world = createLibraryWorld(seed);
      const reviewed = ['1::0', '2::1'];
      for (const unitId of reviewed) world.reviewList.add(unitId);
      const history = simulate(world, {
        exercises: 100,
        answer: always(5),
        filter: reviewListFilter,
      });
      assertScheduledExactly(world, history, ALL_EXERCISES, (id) =>
        reviewed.some((lessonId) => exerciseInLesson(id, lessonId)),
      );
    });
  });

  it('schedule_courses_in_review_list: упражнения курсов из списка повторения', () => {
    forEachSeed((seed) => {
      const world = createLibraryWorld(seed);
      const reviewed = ['1', '2'];
      for (const unitId of reviewed) world.reviewList.add(unitId);
      const history = simulate(world, {
        exercises: 500,
        answer: always(5),
        filter: reviewListFilter,
      });
      assertScheduledExactly(world, history, ALL_EXERCISES, (id) =>
        reviewed.some((courseId) => exerciseInCourse(id, courseId)),
      );
    });
  });
});

describe('фильтры по графу', () => {
  it('schedule_units_and_dependents: юниты и их зависимые', () => {
    forEachSeed((seed) => {
      const world = createLibraryWorld(seed);
      const matching = ['5::0', '5::1', '5::2']; // 5::2 не существует
      const history = simulate(world, {
        exercises: 500,
        answer: always(5),
        filter: { UnitFilter: { Dependents: { unit_ids: ['5::0'] } } },
      });
      assertScheduledExactly(world, history, ALL_EXERCISES, (id) =>
        matching.some((lessonId) => exerciseInLesson(id, lessonId)),
      );
    });
  });

  it('schedule_dependencies: зависимости юнита на заданной глубине', () => {
    forEachSeed((seed) => {
      const world = createLibraryWorld(seed);
      const matching = ['5::0', '5::1'];
      const history = simulate(world, {
        exercises: 500,
        answer: always(5),
        filter: {
          UnitFilter: { Dependencies: { unit_ids: ['5::1'], depth: 1 } },
        },
      });
      assertScheduledExactly(world, history, ALL_EXERCISES, (id) =>
        matching.some((lessonId) => exerciseInLesson(id, lessonId)),
      );
    });
  });

  it('schedule_dependencies_large_depth: глубина больше глубины графа', () => {
    forEachSeed((seed) => {
      const world = createLibraryWorld(seed);
      const matching = ['0', '1', '2', '7', '8'];
      const history = simulate(world, {
        exercises: 500,
        answer: always(5),
        filter: {
          UnitFilter: { Dependencies: { unit_ids: ['2'], depth: 5 } },
        },
      });
      assertScheduledExactly(world, history, ALL_EXERCISES, (id) =>
        matching.some((courseId) => exerciseInCourse(id, courseId)),
      );
    });
  });

  it('schedule_dependencies_unknown_unit: неизвестный юнит — пустой батч', () => {
    forEachSeed((seed) => {
      const world = createLibraryWorld(seed);
      const filter: ExerciseFilterDto = {
        UnitFilter: { Dependencies: { unit_ids: ['20'], depth: 5 } },
      };
      expect(world.getBatch(filter)).toEqual([]);
      const history = simulate(world, {
        exercises: 500,
        answer: always(5),
        filter,
      });
      expect(history.size).toBe(0);
      assertNotScheduled(history, ALL_EXERCISES, () => true);
    });
  });
});

describe('study session', () => {
  it('schedule_study_session: активна вторая часть сессии', () => {
    forEachSeed((seed) => {
      const world = createLibraryWorld(seed);
      // Сессия началась 30 минут назад: часть 1 (курс 0, 15 минут) уже
      // закончилась, идёт часть 2 (курс 1, 30 минут, до 45-й минуты).
      const filter: ExerciseFilterDto = {
        StudySession: {
          startTimeMs: world.clock.now() - 30 * 60_000,
          definition: {
            id: 'session',
            description: 'session',
            parts: [
              {
                UnitFilter: {
                  filter: { CourseFilter: { course_ids: ['0'] } },
                  duration: 15,
                },
              },
              {
                UnitFilter: {
                  filter: { CourseFilter: { course_ids: ['1'] } },
                  duration: 30,
                },
              },
            ],
          },
        },
      };
      // время стоит, чтобы сессия не сменила часть во время симуляции
      const history = simulate(world, {
        exercises: 500,
        answer: always(5),
        filter,
        stepMs: 0,
      });
      assertScheduledExactly(world, history, ALL_EXERCISES, (id) =>
        exerciseInCourse(id, '1'),
      );
    });
  });
});

describe('опции планировщика', () => {
  it('set_scheduler_options: batchSize применяется и ограничивает батч', () => {
    forEachSeed((seed) => {
      const world = createLibraryWorld(seed);
      world.options.set({ batchSize: 3 });
      expect(world.options.get().batchSize).toBe(3);
      const batch = world.getBatch();
      expect(batch.length).toBeGreaterThan(0);
      expect(batch.length).toBeLessThanOrEqual(3);
    });
  });

  it('reset_scheduler_options: сброс возвращает умолчания', () => {
    forEachSeed((seed) => {
      const world = createLibraryWorld(seed);
      world.options.set({ batchSize: 3 });
      world.options.reset();
      expect(world.options.get().batchSize).toBe(
        DEFAULT_SCHEDULER_OPTIONS.batchSize,
      );
      // после сброса батч не ограничен тремя: доступно больше новых
      // упражнений (уроки 0::0, 4::0, 6::0 и др.)
      const batch = world.getBatch();
      expect(batch.length).toBeGreaterThan(3);
      expect(batch.length).toBeLessThanOrEqual(
        DEFAULT_SCHEDULER_OPTIONS.batchSize,
      );
    });
  });
});

describe('большая случайная библиотека (large_tests.rs)', () => {
  it('all_exercises_scheduled_random: при оценке 5 планируются все упражнения случайной библиотеки', () => {
    forEachSeed((seed) => {
      const courses = randomCourseSpecs(createSeededRng(seed), {
        numCourses: 14,
        courseDependencies: [0, 5],
        lessonsPerCourse: [0, 4],
        lessonDependencies: [0, 5],
        exercisesPerLesson: [0, 4],
      });
      const exerciseIds = allTestExercises(courses);
      expect(exerciseIds.length).toBeGreaterThan(20);
      expect(exerciseIds.length).toBeLessThanOrEqual(100);

      const world = createWorld({
        courses,
        seed,
        options: { passingScore: { minAvgTrials: 1 } },
      });
      const history = simulate(world, {
        exercises: exerciseIds.length * 50,
        answer: always(5),
      });
      assertScheduledExactly(world, history, exerciseIds, () => true);
    });
  });
});
