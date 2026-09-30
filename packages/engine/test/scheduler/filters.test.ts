import type {
  KeyValueFilterWire,
  SessionPartWire,
  StudySessionWire,
  UnitFilterWire,
} from '@spirula/engine-contract';
import { describe, expect, it } from 'vitest';
import type { Metadata } from '../../src/domain/manifest.ts';
import {
  keyValueApplyToCourse,
  keyValueApplyToLesson,
  sessionPartAt,
  sessionPartFilterSource,
  unitFilterKind,
  unitFilterPassesCourse,
  unitFilterPassesLesson,
} from '../../src/scheduler/filters.ts';

const courseMeta: Metadata = { course_key_1: ['course_value_1'] };
const lessonMeta: Metadata = { lesson_key_1: ['lesson_value_1'] };

const course = (
  key: string,
  value: string,
  filterType: 'Include' | 'Exclude' = 'Include',
): KeyValueFilterWire => ({
  CourseFilter: { key, value, filter_type: filterType },
});
const lesson = (
  key: string,
  value: string,
  filterType: 'Include' | 'Exclude' = 'Include',
): KeyValueFilterWire => ({
  LessonFilter: { key, value, filter_type: filterType },
});
const all = (...filters: KeyValueFilterWire[]): KeyValueFilterWire => ({
  CombinedFilter: { op: 'All', filters },
});
const any = (...filters: KeyValueFilterWire[]): KeyValueFilterWire => ({
  CombinedFilter: { op: 'Any', filters },
});

const okCourse = course('course_key_1', 'course_value_1');
const badCourse = course('course_key_1', 'nope');
const okLesson = lesson('lesson_key_1', 'lesson_value_1');
const badLesson = lesson('lesson_key_1', 'nope');

describe('unit filters', () => {
  const byCourse: UnitFilterWire = { CourseFilter: { course_ids: ['c1'] } };
  const byLesson: UnitFilterWire = { LessonFilter: { lesson_ids: ['l1'] } };

  it('passes_course_filter: свой id, чужой id, вариант Lesson', () => {
    expect(unitFilterPassesCourse(byCourse, 'c1')).toBe(true);
    expect(unitFilterPassesCourse(byCourse, 'c2')).toBe(false);
    expect(unitFilterPassesCourse(byLesson, 'c1')).toBe(false);
    expect(unitFilterPassesCourse('ReviewListFilter', 'c1')).toBe(false);
  });

  it('passes_lesson_filter: свой id, чужой id, вариант Course', () => {
    expect(unitFilterPassesLesson(byLesson, 'l1')).toBe(true);
    expect(unitFilterPassesLesson(byLesson, 'l2')).toBe(false);
    expect(unitFilterPassesLesson(byCourse, 'l1')).toBe(false);
  });

  it('unitFilterKind различает варианты и отвергает не-один ключ', () => {
    expect(unitFilterKind('ReviewListFilter')).toBe('ReviewListFilter');
    expect(unitFilterKind(byCourse)).toBe('CourseFilter');
    expect(unitFilterKind({ Dependencies: { unit_ids: [], depth: 1 } })).toBe(
      'Dependencies',
    );
    const two = { CourseFilter: { course_ids: [] }, LessonFilter: {} };
    expect(() => unitFilterKind(two as unknown as UnitFilterWire)).toThrow(
      TypeError,
    );
    expect(() => unitFilterKind({} as unknown as UnitFilterWire)).toThrow(
      TypeError,
    );
  });
});

describe('keyValueApplyToCourse', () => {
  it.each([
    ['Include существующей пары', okCourse, true],
    [
      'Exclude существующей пары',
      course('course_key_1', 'course_value_1', 'Exclude'),
      false,
    ],
    ['Include несуществующего значения', badCourse, false],
    ['Include отсутствующего ключа', course('missing', 'x'), false],
    ['Exclude отсутствующего ключа', course('missing', 'x', 'Exclude'), true],
    ['LessonFilter Include на курсе', okLesson, false],
    ['LessonFilter Exclude на курсе', lesson('k', 'v', 'Exclude'), false],
  ])('%s', (_name, filter, expected) => {
    expect(keyValueApplyToCourse(filter, courseMeta)).toBe(expected);
  });

  it('отсутствующие метаданные = пустая мапа', () => {
    expect(keyValueApplyToCourse(okCourse, null)).toBe(false);
    expect(keyValueApplyToCourse(course('k', 'v', 'Exclude'), undefined)).toBe(
      true,
    );
  });

  it('ключи-прототипы не считаются присутствующими', () => {
    expect(
      keyValueApplyToCourse(course('constructor', 'x', 'Exclude'), {}),
    ).toBe(true);
  });

  it.each([
    ['All: все course-фильтры проходят', all(okCourse, okCourse), true],
    ['All: один не проходит', all(okCourse, badCourse), false],
    ['All с LessonFilter', all(okCourse, okLesson), false],
    ['All с вложенным Combined', all(okCourse, okCourse, all(okCourse)), true],
    [
      'All с вложенным Combined, провал внутри',
      all(okCourse, all(badCourse)),
      false,
    ],
    [
      'All: вложенный Combined с LessonFilter → false',
      all(okCourse, all(okCourse, okLesson)),
      false,
    ],
    ['All пустой', all(), true],
    ['Any пустой', any(), false],
    ['Any: один проходит', any(badCourse, okCourse), true],
    ['Any: ни один', any(badCourse, badCourse), false],
    [
      'Any только course-фильтры, вложенный Combined в other → false',
      any(okCourse, any(okCourse)),
      false,
    ],
    ['Any смешанный course+lesson → false', any(okCourse, okLesson), false],
    ['Any вложенный Combined → false', any(badCourse, all(okCourse)), false],
  ])('%s', (_name, filter, expected) => {
    expect(keyValueApplyToCourse(filter, courseMeta)).toBe(expected);
  });
});

describe('keyValueApplyToLesson', () => {
  it.each([
    ['CourseFilter смотрит метаданные курса', okCourse, true],
    ['CourseFilter no_match', badCourse, false],
    [
      'CourseFilter Exclude отсутствующего ключа',
      course('x', 'y', 'Exclude'),
      true,
    ],
    ['LessonFilter смотрит метаданные урока', okLesson, true],
    ['LessonFilter no_match', badLesson, false],
    [
      'LessonFilter Exclude существующей пары',
      lesson('lesson_key_1', 'lesson_value_1', 'Exclude'),
      false,
    ],
    [
      'LessonFilter не видит метаданные курса',
      lesson('course_key_1', 'course_value_1'),
      false,
    ],
    ['All оба проходят', all(okCourse, okLesson), true],
    ['All один не проходит', all(okCourse, badLesson), false],
    ['Any один проходит', any(badCourse, okLesson), true],
    ['Any ни один', any(badCourse, badLesson), false],
    ['вложенный Combined', all(okCourse, any(badLesson, okLesson)), true],
    ['All пустой', all(), true],
    ['Any пустой', any(), false],
  ])('%s', (_name, filter, expected) => {
    expect(keyValueApplyToLesson(filter, courseMeta, lessonMeta)).toBe(
      expected,
    );
  });

  it('отсутствующие метаданные = пустая мапа', () => {
    expect(keyValueApplyToLesson(okLesson, null, undefined)).toBe(false);
    expect(
      keyValueApplyToLesson(lesson('k', 'v', 'Exclude'), undefined, null),
    ).toBe(true);
  });
});

describe('sessionPartAt', () => {
  const START = Date.UTC(2026, 8, 29, 12, 0, 0);
  const MIN = 60_000;
  const noFilter = (duration: number): SessionPartWire => ({
    NoFilter: { duration },
  });
  const at = (definition: StudySessionWire, offsetMs: number) =>
    sessionPartAt({ startTimeMs: START, definition }, START + offsetMs);

  const parts = [
    { UnitFilter: { filter: 'ReviewListFilter', duration: 15 } },
    { SavedFilter: { filter_id: 'f1', duration: 30 } },
    noFilter(5),
  ] satisfies SessionPartWire[];
  const session: StudySessionWire = { id: 's', parts };

  it('пустая сессия → NoFilter{0}', () => {
    expect(at({ id: 's' }, 0)).toEqual(noFilter(0));
    expect(at({ id: 's', parts: [] }, 10 * MIN)).toEqual(noFilter(0));
  });

  it.each([
    [-60 * MIN, 0],
    [-1 * MIN, 0],
    [0, 0],
    [14 * MIN, 0],
    [15 * MIN, 1],
    [44 * MIN, 1],
    [45 * MIN, 2],
    [49 * MIN, 2],
    [50 * MIN, 2],
    [1000 * MIN, 2],
  ])('смещение %i мс → часть %i', (offsetMs, index) => {
    expect(at(session, offsetMs)).toBe(parts[index]);
  });

  it('минуты усекаются к нулю', () => {
    expect(at(session, 14 * MIN + 59_000)).toBe(parts[0]);
    expect(at(session, 15 * MIN - 1)).toBe(parts[0]);
    expect(at(session, -59_000)).toBe(parts[0]);
    expect(at(session, 15 * MIN + 59_000)).toBe(parts[1]);
  });

  it('части с duration 0 пропускаются', () => {
    const zeroFirst: StudySessionWire = {
      id: 'z',
      parts: [noFilter(0), { SavedFilter: { filter_id: 'b', duration: 10 } }],
    };
    expect(at(zeroFirst, 0)).toEqual({
      SavedFilter: { filter_id: 'b', duration: 10 },
    });
    const zeroMiddle: StudySessionWire = {
      id: 'z',
      parts: [
        noFilter(1),
        noFilter(0),
        { SavedFilter: { filter_id: 'c', duration: 5 } },
      ],
    };
    expect(at(zeroMiddle, 1 * MIN)).toEqual({
      SavedFilter: { filter_id: 'c', duration: 5 },
    });
  });

  it('все части нулевые → последняя', () => {
    const zeros: StudySessionWire = {
      id: 'z',
      parts: [noFilter(0), { SavedFilter: { filter_id: 'l', duration: 0 } }],
    };
    expect(at(zeros, 0)).toEqual({
      SavedFilter: { filter_id: 'l', duration: 0 },
    });
  });
});

describe('sessionPartFilterSource', () => {
  it('различает источник фильтра', () => {
    expect(sessionPartFilterSource({ NoFilter: { duration: 1 } })).toEqual({
      kind: 'none',
    });
    expect(
      sessionPartFilterSource({
        UnitFilter: { filter: 'ReviewListFilter', duration: 1 },
      }),
    ).toEqual({ kind: 'unit', filter: 'ReviewListFilter' });
    expect(
      sessionPartFilterSource({ SavedFilter: { filter_id: 'f', duration: 1 } }),
    ).toEqual({ kind: 'saved', filterId: 'f' });
  });
});
