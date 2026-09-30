/**
 * Порт `tests/metadata_tests.rs` Trane (7 тестов): фильтрация по метаданным
 * курсов и уроков (`All`/`Any`, только курсы, только уроки), взаимодействие
 * с blacklist и «мосты» через отфильтрованные зависимости.
 *
 * Отличия от Rust: библиотеки собираются в памяти; оценка юнита читается
 * из `world.scorer.getUnitScore`, порог — из `world.options`; тесты
 * выполняются на нескольких seed (`forEachSeed`).
 */
import { describe, expect, it } from 'vitest';
import type {
  ExerciseFilterDto,
  FilterOp,
  KeyValueFilterWire,
} from '@spirula-app/engine-contract';
import { createWorld } from '../helpers/world.ts';
import type { WorldCourseSpec } from '../helpers/world.ts';
import {
  allTestExercises,
  always,
  assertScheduledExactly,
  course,
  exerciseInCourse,
  exerciseInLesson,
  forEachSeed,
  lesson,
  simulate,
} from './helpers.ts';

/** Метаданные `<prefix>_key_1/2` со значениями `…:value_<n>`. */
const keys = (prefix: string, n: number) => ({
  [`${prefix}_key_1`]: [`${prefix}_key_1:value_${n}`],
  [`${prefix}_key_2`]: [`${prefix}_key_2:value_${n}`],
});

/** Библиотека `metadata_tests.rs`: метаданные на всех курсах и уроках. */
const LIBRARY: WorldCourseSpec[] = [
  course(
    '0',
    [
      lesson('0::0', { metadata: keys('lesson', 1) }),
      lesson('0::1', { dependencies: ['0::0'], metadata: keys('lesson', 2) }),
    ],
    { metadata: keys('course', 1) },
  ),
  course(
    '1',
    [
      lesson('1::0', { metadata: keys('lesson', 3) }),
      lesson('1::1', { dependencies: ['1::0'], metadata: keys('lesson', 3) }),
    ],
    { dependencies: ['0'], metadata: keys('course', 1) },
  ),
  course(
    '2',
    [
      lesson('2::0', { metadata: keys('lesson', 3) }),
      lesson('2::1', { dependencies: ['2::0'], metadata: keys('lesson', 4) }),
      lesson('2::2', { dependencies: ['2::1'], metadata: keys('lesson', 4) }),
    ],
    { dependencies: ['0'], metadata: keys('course', 2) },
  ),
  course(
    '4',
    [
      lesson('4::0', { metadata: keys('lesson', 5) }),
      lesson('4::1', { dependencies: ['4::0'], metadata: keys('lesson', 6) }),
      lesson('4::2', { dependencies: ['4::0'], metadata: keys('lesson', 5) }),
      lesson('4::3', { dependencies: ['4::2'], metadata: keys('lesson', 5) }),
    ],
    { metadata: keys('course', 3) },
  ),
  course(
    '5',
    [
      lesson('5::0', { dependencies: ['4::1'], metadata: keys('lesson', 4) }),
      // зависит от несуществующего урока 3::3
      lesson('5::1', {
        dependencies: ['5::0', '3::3'],
        metadata: keys('lesson', 5),
      }),
    ],
    {
      // зависит от несуществующего курса 3
      dependencies: ['3', '4'],
      metadata: keys('course', 2),
    },
  ),
];

const BRIDGE = { bridge_key: ['bridge_key:keep'] };

/** Цепочка A → B → C → D, где фильтр пропускает только A и D. */
const BRIDGE_LIBRARY: WorldCourseSpec[] = [
  course('0', [lesson('0::0', { exercises: 1, metadata: BRIDGE })]),
  course('1', [lesson('1::0', { exercises: 1, dependencies: ['0::0'] })]),
  course('2', [lesson('2::0', { exercises: 1, dependencies: ['1::0'] })]),
  course('3', [
    lesson('3::0', { exercises: 1, dependencies: ['2::0'], metadata: BRIDGE }),
  ]),
];

/**
 * Два случая: (1) отфильтрованная зависимость-курс с подходящими уроками
 * внутри; (2) отфильтрованная зависимость-курс без подходящих уроков,
 * зависящая от урока другого курса.
 */
const BRIDGE_COURSE_LIBRARY: WorldCourseSpec[] = [
  course('0', [
    lesson('0::0', { exercises: 1, metadata: BRIDGE }),
    lesson('0::1', { exercises: 1, dependencies: ['0::0'], metadata: BRIDGE }),
  ]),
  course('1', [
    lesson('1::0', { exercises: 1, dependencies: ['0'], metadata: BRIDGE }),
  ]),
  course('2', [lesson('2::0', { exercises: 1, metadata: BRIDGE })]),
  course('3', [lesson('3::0', { exercises: 1 })], { dependencies: ['2::0'] }),
  course('4', [
    lesson('4::0', { exercises: 1, dependencies: ['3'], metadata: BRIDGE }),
  ]),
];

const ALL_EXERCISES = allTestExercises(LIBRARY);

const courseKv = (key: string, value: string): KeyValueFilterWire => ({
  CourseFilter: { key, value, filter_type: 'Include' },
});
const lessonKv = (key: string, value: string): KeyValueFilterWire => ({
  LessonFilter: { key, value, filter_type: 'Include' },
});
const combined = (
  op: FilterOp,
  ...filters: KeyValueFilterWire[]
): KeyValueFilterWire => ({ CombinedFilter: { op, filters } });
const metadataFilter = (filter: KeyValueFilterWire): ExerciseFilterDto => ({
  UnitFilter: { MetadataFilter: { filter } },
});

const COURSE_2 = courseKv('course_key_1', 'course_key_1:value_2');
const LESSON_4 = lessonKv('lesson_key_2', 'lesson_key_2:value_4');
const BRIDGE_LESSONS = metadataFilter(
  lessonKv('bridge_key', 'bridge_key:keep'),
);

/** Прогон на библиотеке метаданных с оценкой 5. */
const runMetadata = (
  seed: number,
  filter: ExerciseFilterDto,
  blacklist: string[] = [],
) => {
  const world = createWorld({ courses: LIBRARY, seed });
  const history = simulate(world, {
    exercises: 500,
    answer: always(5),
    filter,
    blacklist,
  });
  return { world, history };
};

describe('фильтр по метаданным', () => {
  it('scheduler_respects_metadata_filter_op_all: логическое И', () => {
    forEachSeed((seed) => {
      const { world, history } = runMetadata(
        seed,
        metadataFilter(combined('All', COURSE_2, LESSON_4)),
      );
      const matching = ['2::1', '2::2', '5::0'];
      assertScheduledExactly(world, history, ALL_EXERCISES, (id) =>
        matching.some((lessonId) => exerciseInLesson(id, lessonId)),
      );
    });
  });

  it('scheduler_respects_metadata_filter_op_any: логическое ИЛИ', () => {
    forEachSeed((seed) => {
      const { world, history } = runMetadata(
        seed,
        metadataFilter(combined('Any', COURSE_2, LESSON_4)),
      );
      const matching = ['2::0', '2::1', '2::2', '5::0', '5::1'];
      assertScheduledExactly(world, history, ALL_EXERCISES, (id) =>
        matching.some((lessonId) => exerciseInLesson(id, lessonId)),
      );
    });
  });

  it('scheduler_respects_lesson_metadata_filter: фильтр по метаданным уроков', () => {
    forEachSeed((seed) => {
      const { world, history } = runMetadata(seed, metadataFilter(LESSON_4));
      const matching = ['2::1', '2::2', '5::0'];
      assertScheduledExactly(world, history, ALL_EXERCISES, (id) =>
        matching.some((lessonId) => exerciseInLesson(id, lessonId)),
      );
    });
  });

  it('scheduler_respects_course_metadata_filter: фильтр по метаданным курсов', () => {
    forEachSeed((seed) => {
      const { world, history } = runMetadata(seed, metadataFilter(COURSE_2));
      const matching = ['2', '5'];
      assertScheduledExactly(world, history, ALL_EXERCISES, (id) =>
        matching.some((courseId) => exerciseInCourse(id, courseId)),
      );
    });
  });

  it('scheduler_respects_metadata_filter_and_blacklist: blacklist сильнее фильтра', () => {
    forEachSeed((seed) => {
      const { world, history } = runMetadata(
        seed,
        metadataFilter(combined('All', COURSE_2, LESSON_4)),
        ['2'],
      );
      assertScheduledExactly(world, history, ALL_EXERCISES, (id) =>
        exerciseInLesson(id, '5::0'),
      );
    });
  });
});

describe('мосты через отфильтрованные зависимости', () => {
  it('scheduler_bridges_filtered_dependency_chain: цепочка A → B → C → D, фильтр пропускает A и D', () => {
    forEachSeed((seed) => {
      const world = createWorld({ courses: BRIDGE_LIBRARY, seed });

      // Оценка 1: A остаётся ниже проходного балла, D закрыт.
      let history = simulate(world, {
        exercises: 400,
        answer: always(1),
        filter: BRIDGE_LESSONS,
      });
      expect(world.library.getExerciseIds('0::0')).toEqual(['0::0::0']);
      const score = world.scorer.getUnitScore('0::0');
      expect(score, 'lesson 0::0 should have a valid score').not.toBeNull();
      expect(score as number).toBeLessThan(
        world.options.get().passingScore.minScore,
      );
      expect(history.has('0::0::0')).toBe(true);
      expect(
        history.has('3::0::0'),
        'D should stay blocked while dependencies are not mastered',
      ).toBe(false);

      // Оценка 5: D открывается через мост A → D.
      history = simulate(world, {
        exercises: 400,
        answer: always(5),
        filter: BRIDGE_LESSONS,
      });
      expect(
        history.has('3::0::0'),
        'D should be scheduled after dependencies are mastered',
      ).toBe(true);
    });
  });

  it('scheduler_bridges_filtered_course_dependencies: мост через курсы внутри курса и между курсами', () => {
    forEachSeed((seed) => {
      const world = createWorld({ courses: BRIDGE_COURSE_LIBRARY, seed });

      // Первый урок курса 0 освоен, последний — нет: зависимые от курса 0
      // (1::0 в другом курсе и 4::0 через курс 3 → урок 2::0) закрыты.
      let history = simulate(world, {
        exercises: 500,
        answer: (id) => (id.startsWith('0::0::') ? 5 : 1),
        filter: BRIDGE_LESSONS,
      });
      expect(
        history.has('1::0::0'),
        '1::0::0 should stay blocked while the last matching lesson is unmastered',
      ).toBe(false);
      expect(
        history.has('4::0::0'),
        '4::0::0 should stay blocked while the external lesson dependency is unmastered',
      ).toBe(false);

      // Оценка 5: оба зависимых достижимы.
      history = simulate(world, {
        exercises: 500,
        answer: always(5),
        filter: BRIDGE_LESSONS,
      });
      expect(
        history.has('1::0::0'),
        '1::0::0 should be scheduled after the course dependency is satisfied',
      ).toBe(true);
      expect(
        history.has('4::0::0'),
        '4::0::0 should be scheduled after the external lesson dependency is satisfied',
      ).toBe(true);
    });
  });
});
