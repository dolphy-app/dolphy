import type { UnitId } from '@dolphy-app/engine-contract';
import type { CourseSummary } from '@/entities/course';

/**
 * Состояние курса для ученика. `mastered` движка (оценки прошли порог) не
 * равно «курс пройден», поэтому «пройден» — все уроки освоены: одна метрика
 * (уроки), без расхождения «Освоен» при неполном прогрессе.
 */
export type CourseState =
  | 'not-started'
  | 'in-progress'
  | 'completed'
  | 'locked'
  | 'hidden'
  | 'superseded';

export type StateFilter = 'all' | 'not-started' | 'in-progress' | 'completed';
export type CourseSort = 'name' | 'progress' | 'due';

export interface CourseFilters {
  query: string;
  state: StateFilter;
  sort: CourseSort;
}

export const STATE_FILTERS: readonly StateFilter[] = [
  'all',
  'not-started',
  'in-progress',
  'completed',
];
export const COURSE_SORTS: readonly CourseSort[] = ['name', 'progress', 'due'];

export const courseState = (course: CourseSummary): CourseState => {
  if (course.status === 'blacklisted') return 'hidden';
  if (course.status === 'superseded') return 'superseded';
  if (course.status === 'locked') return 'locked';
  if (course.attempts === 0) return 'not-started';
  return course.lessonCount > 0 && course.lessonsDone >= course.lessonCount
    ? 'completed'
    : 'in-progress';
};

/** Доля пройденных уроков, 0..1. */
export const courseProgress = ({ lessonsDone, lessonCount }: CourseSummary) =>
  lessonCount === 0 ? 0 : Math.min(lessonsDone / lessonCount, 1);

const compareName = (a: CourseSummary, b: CourseSummary) =>
  a.name.localeCompare(b.name);

const COMPARE: Record<
  CourseSort,
  (a: CourseSummary, b: CourseSummary) => number
> = {
  name: compareName,
  progress: (a, b) =>
    courseProgress(b) - courseProgress(a) || compareName(a, b),
  due: (a, b) => b.due - a.due || compareName(a, b),
};

/** Поиск по названию и описанию, фильтр по состоянию, сортировка; исходный список не меняется. */
export const filterCourses = (
  courses: readonly CourseSummary[],
  { query, state, sort }: CourseFilters,
): CourseSummary[] => {
  const needle = query.trim().toLocaleLowerCase();
  return courses
    .filter(
      (course) =>
        (state === 'all' || courseState(course) === state) &&
        (needle === '' ||
          course.name.toLocaleLowerCase().includes(needle) ||
          (course.description ?? '').toLocaleLowerCase().includes(needle)),
    )
    .sort(COMPARE[sort]);
};

const byRecentAttempt = (a: CourseSummary, b: CourseSummary) =>
  (b.lastAttemptAt ?? 0) - (a.lastAttemptAt ?? 0) || compareName(a, b);

/**
 * Курс, который стоит учить сейчас, когда фокуса нет: больше всего повторений,
 * иначе начатый последним, иначе первый неначатый. Закрытые, скрытые и уже
 * пройденные не предлагаются; `null` — предлагать нечего.
 */
export const recommendCourse = (
  courses: readonly CourseSummary[],
): UnitId | null => {
  const open = courses.filter((course) => {
    const state = courseState(course);
    return state === 'in-progress' || state === 'not-started';
  });
  const due = open
    .filter((course) => course.due > 0)
    .sort((a, b) => b.due - a.due || byRecentAttempt(a, b));
  const inProgress = open
    .filter((course) => courseState(course) === 'in-progress')
    .sort(byRecentAttempt);
  const notStarted = open.filter(
    (course) => courseState(course) === 'not-started',
  );
  return (due[0] ?? inProgress[0] ?? notStarted[0])?.id ?? null;
};
