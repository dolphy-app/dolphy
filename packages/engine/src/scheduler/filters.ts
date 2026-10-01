/**
 * Чистые функции над wire-типами фильтров Trane v0.34.1
 * (`data/filter.rs`). Внутренних
 * нормализованных типов нет: работа идёт прямо с внешне тегированными
 * объектами контракта.
 */
import type {
  EpochMs,
  KeyValueFilterWire,
  SessionPartWire,
  StudySessionWire,
  UnitFilterWire,
} from '@dolphy-app/engine-contract';
import type { Metadata } from '../domain/manifest.ts';

export type UnitFilterKind =
  | 'CourseFilter'
  | 'LessonFilter'
  | 'MetadataFilter'
  | 'ReviewListFilter'
  | 'Dependents'
  | 'Dependencies';

export type SessionPartKind = 'UnitFilter' | 'SavedFilter' | 'NoFilter';

export type SessionPartFilterSource =
  | { kind: 'none' }
  | { kind: 'unit'; filter: UnitFilterWire }
  | { kind: 'saved'; filterId: string };

const MS_PER_MINUTE = 60_000;

const EMPTY_METADATA: Metadata = {};

/** Имя варианта внешне тегированного объекта; ровно один ключ, иначе отказ. */
const singleKey = (value: object): string => {
  const keys = Object.keys(value);
  if (keys.length !== 1) {
    throw new TypeError(
      `tagged variant must have exactly one key, got ${keys.length}`,
    );
  }
  return keys[0]!;
};

/** Вариант `UnitFilterWire`: unit-вариант — голая строка. */
export const unitFilterKind = (filter: UnitFilterWire): UnitFilterKind =>
  typeof filter === 'string' ? filter : (singleKey(filter) as UnitFilterKind);

export const sessionPartKind = (part: SessionPartWire): SessionPartKind =>
  singleKey(part) as SessionPartKind;

/** Что выбирает часть сессии: весь граф, встроенный или сохранённый фильтр. */
export const sessionPartFilterSource = (
  part: SessionPartWire,
): SessionPartFilterSource => {
  if ('UnitFilter' in part) {
    singleKey(part);
    return { kind: 'unit', filter: part.UnitFilter.filter };
  }
  if ('SavedFilter' in part) {
    singleKey(part);
    return { kind: 'saved', filterId: part.SavedFilter.filter_id };
  }
  singleKey(part);
  return { kind: 'none' };
};

export const sessionPartDurationMinutes = (part: SessionPartWire): number => {
  if ('UnitFilter' in part) return part.UnitFilter.duration;
  if ('SavedFilter' in part) return part.SavedFilter.duration;
  return part.NoFilter.duration;
};

const passesKeyValue = (
  metadata: Metadata,
  key: string,
  value: string,
  filterType: 'Include' | 'Exclude',
): boolean => {
  const contains = Object.hasOwn(metadata, key)
    ? metadata[key]!.includes(value)
    : false;
  return filterType === 'Include' ? contains : !contains;
};

const combine = <T>(
  op: 'All' | 'Any',
  items: readonly T[],
  predicate: (item: T) => boolean,
): boolean => (op === 'All' ? items.every(predicate) : items.some(predicate));

/** Применение фильтра к курсу; `LessonFilter` на курсе всегда `false`. */
export const keyValueApplyToCourse = (
  filter: KeyValueFilterWire,
  courseMetadata: Metadata | null | undefined,
): boolean => {
  const metadata = courseMetadata ?? EMPTY_METADATA;
  singleKey(filter);
  if ('CourseFilter' in filter) {
    const { key, value, filter_type: type } = filter.CourseFilter;
    return passesKeyValue(metadata, key, value, type);
  }
  if ('LessonFilter' in filter) return false;
  const { op, filters } = filter.CombinedFilter;
  const isCourse = (f: KeyValueFilterWire) => 'CourseFilter' in f;
  const courseFilters = filters.filter(isCourse);
  const otherFilters = filters.filter((f) => !isCourse(f));
  const apply = (f: KeyValueFilterWire) => keyValueApplyToCourse(f, metadata);
  const courseResult = combine(op, courseFilters, apply);
  if (otherFilters.length === 0) return courseResult;
  // `Any` с «чужими» под-фильтрами: курс пропускается, решают уроки.
  if (op === 'Any') return false;
  return courseResult && combine(op, otherFilters, apply);
};

/** Применение фильтра к уроку; `CourseFilter` смотрит метаданные курса. */
export const keyValueApplyToLesson = (
  filter: KeyValueFilterWire,
  courseMetadata: Metadata | null | undefined,
  lessonMetadata: Metadata | null | undefined,
): boolean => {
  const course = courseMetadata ?? EMPTY_METADATA;
  const lesson = lessonMetadata ?? EMPTY_METADATA;
  singleKey(filter);
  if ('CourseFilter' in filter) {
    const { key, value, filter_type: type } = filter.CourseFilter;
    return passesKeyValue(course, key, value, type);
  }
  if ('LessonFilter' in filter) {
    const { key, value, filter_type: type } = filter.LessonFilter;
    return passesKeyValue(lesson, key, value, type);
  }
  const { op, filters } = filter.CombinedFilter;
  return combine(op, filters, (f) => keyValueApplyToLesson(f, course, lesson));
};

export const unitFilterPassesCourse = (
  filter: UnitFilterWire,
  courseId: string,
): boolean =>
  typeof filter === 'object' &&
  'CourseFilter' in filter &&
  filter.CourseFilter.course_ids.includes(courseId);

export const unitFilterPassesLesson = (
  filter: UnitFilterWire,
  lessonId: string,
): boolean =>
  typeof filter === 'object' &&
  'LessonFilter' in filter &&
  filter.LessonFilter.lesson_ids.includes(lessonId);

/** Часть сессии, которую нужно заниматься в момент `nowMs` (`get_part`). */
export const sessionPartAt = (
  session: { startTimeMs: EpochMs; definition: StudySessionWire },
  nowMs: EpochMs,
): SessionPartWire => {
  const parts = session.definition.parts ?? [];
  const first = parts[0];
  if (first === undefined) return { NoFilter: { duration: 0 } };
  const minutes = Math.trunc((nowMs - session.startTimeMs) / MS_PER_MINUTE);
  if (minutes < 0) return first;
  let elapsed = 0;
  for (const part of parts) {
    elapsed += sessionPartDurationMinutes(part);
    if (minutes < elapsed) return part;
  }
  return parts[parts.length - 1]!;
};
