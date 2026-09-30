/**
 * Порт модульных тестов `scheduler/data.rs` (mod test, :423-747, 6 тестов) и
 * пробелов спеки: `getDependenciesAtDepth`, `insideBlacklisted`.
 *
 * Отличия от Rust: `frequency_map` и `success_rate` живут не в
 * `SchedulerData`, а в `SessionState` (тесты `exercise_frequency` и
 * `success_rate` идут на нём); `Utc::now()` в `get_session_filter` заменён
 * фиксированным временем (`T0_MS`); ошибки — `SchedulerError` с кодом;
 * `all_valid_exercises` (все типы юнитов) — `scoring/graph.ts`, урок —
 * `SchedulerData.allValidExercisesInLesson`.
 */
import type {
  SavedFilterDto,
  StudySessionWire,
  UnitFilterWire,
} from '@spirula-app/engine-contract';
import { T0_MS } from '@spirula-app/testkit';
import { describe, expect, it } from 'vitest';
import { createUnitGraph } from '../../src/domain/graph.ts';
import { allValidExercises } from '../../src/scoring/graph.ts';
import {
  SchedulerError,
  createSchedulerData,
  createSchedulerOptions,
  createSchedulerOptionsHolder,
  createSessionState,
  toScoringGraph,
} from '../../src/scheduler/index.ts';
import type {
  SchedulerLibrary,
  StudySessionRun,
} from '../../src/scheduler/index.ts';
import { createCountingRng } from './helpers/counting-rng.ts';
import { buildWorldLibrary } from './helpers/world.ts';
import type { WorldCourseSpec } from './helpers/world.ts';

const MINUTE_MS = 60_000;

/** Курс «0» с двумя уроками по два упражнения (`TEST_LIBRARY` data.rs). */
const TEST_LIBRARY: WorldCourseSpec[] = [
  {
    id: '0',
    metadata: {
      course_key_1: ['course_key_1:value_1'],
      course_key_2: ['course_key_2:value_1'],
    },
    lessons: [
      {
        id: '0::0',
        exercises: 2,
        metadata: {
          lesson_key_1: ['lesson_key_1:value_1'],
          lesson_key_2: ['lesson_key_2:value_1'],
        },
      },
      {
        id: '0::1',
        dependencies: ['0::0'],
        exercises: 2,
        metadata: {
          lesson_key_1: ['lesson_key_1:value_2'],
          lesson_key_2: ['lesson_key_2:value_2'],
        },
      },
    ],
  },
];

const createFixture = (savedFilters: SavedFilterDto[] = []) => {
  const library = buildWorldLibrary(TEST_LIBRARY);
  const blacklisted = new Set<string>();
  const filters = new Map(savedFilters.map((saved) => [saved.id, saved]));
  const data = createSchedulerData({
    library: () => library,
    blacklist: { isBlacklisted: (unitId) => blacklisted.has(unitId) },
    reviewList: { entries: () => [] },
    savedFilters: { getFilter: (id) => filters.get(id) },
  });
  return { library, blacklisted, data };
};

describe('SchedulerData', () => {
  it('unit_exists: типы и существование юнитов', () => {
    const { data } = createFixture();
    expect(data.getUnitTypeStrict('0')).toBe('Course');
    expect(data.unitExists('0')).toBe(true);
    expect(data.getUnitTypeStrict('0::0')).toBe('Lesson');
    expect(data.unitExists('0::0')).toBe(true);
    expect(data.getUnitTypeStrict('0::0::0')).toBe('Exercise');
    expect(data.unitExists('0::0::0')).toBe(true);
    expect(data.unitExists('missing')).toBe(false);
    expect(data.getUnitType('missing')).toBeUndefined();
  });

  it('unit_exists: неизвестный юнит в строгом варианте — UNKNOWN_UNIT', () => {
    const { data } = createFixture();
    expect(() => data.getUnitTypeStrict('missing')).toThrow(
      expect.objectContaining({ code: 'UNKNOWN_UNIT' }),
    );
  });

  it('unit_exists: юнит в графе без манифеста не существует', () => {
    const { library } = createFixture();
    const partial: SchedulerLibrary = {
      graph: library.graph,
      getCourse: () => undefined,
      getLesson: library.getLesson,
      getExercise: library.getExercise,
    };
    const data = createSchedulerData({
      library: () => partial,
      blacklist: { isBlacklisted: () => false },
      reviewList: { entries: () => [] },
      savedFilters: { getFilter: () => undefined },
    });
    expect(data.getUnitType('0')).toBe('Course');
    expect(data.unitExists('0')).toBe(false);
    expect(data.unitExists('0::0')).toBe(true);
  });

  it('exercise_metadata_filter: фильтр метаданных к упражнению — ошибка', () => {
    const { data } = createFixture();
    const filter = {
      CourseFilter: { key: 'key', value: 'value', filter_type: 'Include' },
    } as const;
    expect(() => data.unitPassesFilter('0::0::0', filter)).toThrow(
      SchedulerError,
    );
    expect(() => data.unitPassesFilter('0::0::0', filter)).toThrow(
      expect.objectContaining({ code: 'FILTER_ON_EXERCISE' }),
    );
  });

  it('unit_passes_filter: без фильтра — true, курс и урок по метаданным', () => {
    const { data } = createFixture();
    expect(data.unitPassesFilter('0::0::0', null)).toBe(true);
    const course = (value: string) =>
      ({
        CourseFilter: {
          key: 'course_key_1',
          value,
          filter_type: 'Include',
        },
      }) as const;
    expect(data.unitPassesFilter('0', course('course_key_1:value_1'))).toBe(
      true,
    );
    expect(data.unitPassesFilter('0', course('other'))).toBe(false);
    const lesson = (value: string) =>
      ({
        LessonFilter: {
          key: 'lesson_key_1',
          value,
          filter_type: 'Include',
        },
      }) as const;
    expect(data.unitPassesFilter('0::1', lesson('lesson_key_1:value_2'))).toBe(
      true,
    );
    expect(data.unitPassesFilter('0::0', lesson('lesson_key_1:value_2'))).toBe(
      false,
    );
  });

  it('unit_passes_filter: неизвестный юнит — UNKNOWN_UNIT', () => {
    const { data } = createFixture();
    const filter = {
      CourseFilter: { key: 'k', value: 'v', filter_type: 'Include' },
    } as const;
    expect(() => data.unitPassesFilter('missing', filter)).toThrow(
      expect.objectContaining({ code: 'UNKNOWN_UNIT' }),
    );
  });

  describe('get_session_filter', () => {
    const REVIEW: UnitFilterWire = 'ReviewListFilter';
    const SAVED: UnitFilterWire = { CourseFilter: { course_ids: ['0'] } };
    const session = (definition: StudySessionWire): StudySessionRun => ({
      startTimeMs: T0_MS,
      definition,
    });
    const definition: StudySessionWire = {
      id: 'session',
      description: 'Session',
      parts: [
        { UnitFilter: { filter: REVIEW, duration: 1 } },
        { NoFilter: { duration: 1 } },
        { SavedFilter: { filter_id: 'saved_filter', duration: 1 } },
      ],
    };
    const saved: SavedFilterDto = {
      id: 'saved_filter',
      description: 'Saved filter',
      filter: SAVED,
    };

    it('часть сессии выбирается по времени; SavedFilter даёт сохранённый фильтр', () => {
      const { data } = createFixture([saved]);
      const run = session(definition);
      expect(data.getSessionFilter(run, T0_MS)).toEqual(REVIEW);
      expect(data.getSessionFilter(run, T0_MS + MINUTE_MS - 1)).toEqual(REVIEW);
      expect(data.getSessionFilter(run, T0_MS + MINUTE_MS)).toBeNull();
      expect(data.getSessionFilter(run, T0_MS + 2 * MINUTE_MS)).toEqual(SAVED);
    });

    it('неизвестный сохранённый фильтр — MISSING_SAVED_FILTER', () => {
      const { data } = createFixture([saved]);
      const run = session({
        id: 'session',
        parts: [{ SavedFilter: { filter_id: 'unknown_filter', duration: 1 } }],
      });
      expect(() => data.getSessionFilter(run, T0_MS)).toThrow(
        expect.objectContaining({
          code: 'MISSING_SAVED_FILTER',
          details: { filterId: 'unknown_filter' },
        }),
      );
    });

    it('пустая сессия — «без фильтра»', () => {
      const { data } = createFixture();
      expect(data.getSessionFilter(session({ id: 'empty' }), T0_MS)).toBeNull();
    });
  });

  describe('all_valid_exercises', () => {
    it('все типы юнитов с учётом blacklist (scoring/graph.ts)', () => {
      const { library, blacklisted } = createFixture();
      const graph = toScoringGraph(library.graph);
      const view = {
        isBlacklisted: (unitId: string) => blacklisted.has(unitId),
      };
      const valid = (unitId: string) =>
        allValidExercises(graph, view, unitId).sort();

      // неизвестный юнит — пусто
      expect(valid('unknown')).toEqual([]);

      // упражнение
      expect(valid('0::0::0')).toEqual(['0::0::0']);
      blacklisted.add('0::0::0');
      expect(valid('0::0::0')).toEqual([]);

      // урок
      expect(valid('0::1')).toEqual(['0::1::0', '0::1::1']);
      blacklisted.add('0::1');
      expect(valid('0::1')).toEqual([]);

      // курс: остаётся единственное упражнение 0::0::1
      expect(valid('0')).toEqual(['0::0::1']);
      blacklisted.add('0');
      expect(valid('0')).toEqual([]);
    });

    it('allValidExercisesInLesson: урок, курс и упражнение в blacklist', () => {
      const { data, blacklisted } = createFixture();
      expect(data.allValidExercisesInLesson('0::1').sort()).toEqual([
        '0::1::0',
        '0::1::1',
      ]);
      blacklisted.add('0::1::0');
      expect(data.allValidExercisesInLesson('0::1')).toEqual(['0::1::1']);
      blacklisted.add('0::1');
      expect(data.allValidExercisesInLesson('0::1')).toEqual([]);
      expect(data.allValidExercisesInLesson('0::0')).toHaveLength(2);
      blacklisted.add('0');
      expect(data.allValidExercisesInLesson('0::0')).toEqual([]);
      expect(data.allValidExercisesInLesson('unknown')).toEqual([]);
    });
  });

  it('insideBlacklisted: само упражнение, его урок или курс', () => {
    const { data, blacklisted } = createFixture();
    expect(data.insideBlacklisted('0::0::0')).toBe(false);
    blacklisted.add('0::0::0');
    expect(data.insideBlacklisted('0::0::0')).toBe(true);
    expect(data.insideBlacklisted('0::0::1')).toBe(false);
    blacklisted.add('0::1');
    expect(data.insideBlacklisted('0::1::1')).toBe(true);
    expect(data.insideBlacklisted('0::0::1')).toBe(false);
    blacklisted.add('0');
    expect(data.insideBlacklisted('0::0::1')).toBe(true);
    expect(data.blacklisted('0::0::1')).toBe(false);
    expect(data.blacklisted('0')).toBe(true);
  });

  it('getLessonId, getCourseId, getExerciseManifest, getNumLessonsInCourse', () => {
    const { data } = createFixture();
    expect(data.getLessonId('0::1::0')).toBe('0::1');
    expect(data.getCourseId('0::1')).toBe('0');
    expect(data.getExerciseManifest('0::1::0').id).toBe('0::1::0');
    expect(data.getNumLessonsInCourse('0')).toBe(2);
    expect(data.getNumLessonsInCourse('missing')).toBe(0);
    expect(() => data.getLessonId('missing')).toThrow(
      expect.objectContaining({ code: 'MISSING_LESSON' }),
    );
    expect(() => data.getCourseId('missing')).toThrow(
      expect.objectContaining({ code: 'MISSING_COURSE' }),
    );
    expect(() => data.getExerciseManifest('missing')).toThrow(
      expect.objectContaining({ code: 'MISSING_MANIFEST' }),
    );
  });
});

describe('getDependenciesAtDepth', () => {
  /**
   * Курсы `c0` ← `c1` ← `c2`; урок `k::1` зависит от `k::0` и от
   * отсутствующего `gone::0`; ромб `d::0` ← `d::1`, `d::2` ← `d::3`.
   */
  const createDataWithGraph = () => {
    const graph = createUnitGraph();
    for (const course of ['c0', 'c1', 'c2', 'k', 'd']) graph.addCourse(course);
    graph.addDependencies('c1', 'Course', ['c0']);
    graph.addDependencies('c2', 'Course', ['c1']);
    for (const lesson of ['k::0', 'k::1', 'k::2']) graph.addLesson(lesson, 'k');
    graph.addDependencies('k::1', 'Lesson', ['k::0', 'gone::0']);
    graph.addDependencies('k::2', 'Lesson', ['k::1']);
    for (const lesson of ['d::0', 'd::1', 'd::2', 'd::3']) {
      graph.addLesson(lesson, 'd');
    }
    graph.addDependencies('d::1', 'Lesson', ['d::0']);
    graph.addDependencies('d::2', 'Lesson', ['d::0']);
    graph.addDependencies('d::3', 'Lesson', ['d::1', 'd::2']);
    const library: SchedulerLibrary = {
      graph,
      getCourse: () => undefined,
      getLesson: () => undefined,
      getExercise: () => undefined,
    };
    return createSchedulerData({
      library: () => library,
      blacklist: { isBlacklisted: () => false },
      reviewList: { entries: () => [] },
      savedFilters: { getFilter: () => undefined },
    });
  };

  it.each([
    { unit: 'k::2', depth: 0, expected: ['k::2'] },
    { unit: 'k::2', depth: 1, expected: ['k::1'] },
    // gone::0 отсутствует в графе и отфильтрован
    { unit: 'k::1', depth: 1, expected: ['k::0'] },
    { unit: 'k::2', depth: 2, expected: ['k::0'] },
    // глубже графа — листья-источники
    { unit: 'k::2', depth: 10, expected: ['k::0'] },
    { unit: 'k::0', depth: 3, expected: ['k::0'] },
    { unit: 'c2', depth: 1, expected: ['c1'] },
    { unit: 'c2', depth: 5, expected: ['c0'] },
    // ромб: результат без дедупликации
    { unit: 'd::3', depth: 2, expected: ['d::0', 'd::0'] },
    { unit: 'd::3', depth: 1, expected: ['d::1', 'd::2'] },
    // неизвестный юнит — пусто
    { unit: 'unknown', depth: 2, expected: [] },
  ])('$unit, depth=$depth → $expected', ({ unit, depth, expected }) => {
    const found = createDataWithGraph().getDependenciesAtDepth(unit, depth);
    expect(found.sort()).toEqual([...expected].sort());
  });
});

describe('SessionState', () => {
  const createSession = () => {
    const holder = createSchedulerOptionsHolder(createSchedulerOptions());
    return createSessionState({
      options: holder.get,
      rng: createCountingRng().rng,
    });
  };

  it('exercise_frequency: счётчик показов растёт с нуля', () => {
    const session = createSession();
    expect(session.frequencyOf('0::0::0')).toBe(0);
    session.incrementFrequency('0::0::0');
    expect(session.frequencyOf('0::0::0')).toBe(1);
    session.incrementFrequency('0::0::0');
    expect(session.frequencyOf('0::0::0')).toBe(2);
    expect(session.frequencyOf('0::0::1')).toBe(0);
  });

  it('success_rate: 1.0 без попыток; оценки 1–2 — провал, 3–5 — успех', () => {
    const session = createSession();
    expect(session.successRate()).toBe(1.0);
    for (const grade of [1, 2, 3, 4, 5] as const) {
      session.noteResult('0::0::0', grade);
    }
    expect(session.successRate()).toBe(0.6);
    expect(session.trialCounts()).toEqual({ success: 3, failed: 2 });
  });

  it('success_rate: f32-двойник возвращает округлённую долю', () => {
    const holder = createSchedulerOptionsHolder(createSchedulerOptions());
    const session = createSessionState({
      options: holder.get,
      rng: createCountingRng().rng,
      precision: 'f32',
    });
    session.noteResult('a', 1);
    session.noteResult('b', 5);
    session.noteResult('c', 5);
    expect(session.successRate()).toBe(Math.fround(2 / 3));
  });

  it('reset: чистит частоты, пул повторов и счётчики', () => {
    const session = createSession();
    session.incrementFrequency('0::0::0');
    session.noteResult('0::0::0', 1);
    session.noteResult('0::0::1', 5);
    expect(session.relearnPile.has('0::0::0')).toBe(true);
    session.reset();
    expect(session.frequencyOf('0::0::0')).toBe(0);
    expect(session.relearnPile.size).toBe(0);
    expect(session.successRate()).toBe(1.0);
    expect(session.trialCounts()).toEqual({ success: 0, failed: 0 });
  });
});
