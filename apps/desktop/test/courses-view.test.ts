import { describe, expect, it } from 'vitest';
import type { CourseSummary } from '@/entities/course';
import {
  courseProgress,
  courseState,
  filterCourses,
  recommendCourse,
} from '@/pages/courses/model/courses-view.ts';
import type { CourseFilters } from '@/pages/courses/model/courses-view.ts';

const course = (
  id: string,
  extra: Partial<CourseSummary> = {},
): CourseSummary => ({
  id,
  name: id,
  lessonCount: 4,
  lessonsDone: 0,
  status: 'ready',
  attempts: 0,
  due: 0,
  ...extra,
});

const git = course('Git', {
  status: 'in-progress',
  attempts: 5,
  lessonsDone: 1,
  due: 2,
  lastAttemptAt: 100,
});
const http = course('HTTP', { description: 'Methods and caching' });
const sql = course('SQL', {
  status: 'mastered',
  attempts: 9,
  lessonsDone: 4,
  due: 5,
  lastAttemptAt: 300,
});
const courses = [git, http, sql];

describe('courseState', () => {
  it('a course is completed only when every lesson is mastered, whatever the engine status says', () => {
    expect(courseState(sql)).toBe('completed');
    expect(courseState({ ...sql, lessonsDone: 3 })).toBe('in-progress');
  });

  it('no attempts means not started; blocked, hidden and superseded stay as the engine reports', () => {
    expect(courseState(http)).toBe('not-started');
    expect(courseState(course('a', { status: 'locked' }))).toBe('locked');
    expect(
      courseState(course('a', { status: 'blacklisted', attempts: 3 })),
    ).toBe('hidden');
    expect(courseState(course('a', { status: 'superseded' }))).toBe(
      'superseded',
    );
  });

  it('a course without lessons is never completed', () => {
    const empty = course('a', { lessonCount: 0, attempts: 1 });
    expect(courseState(empty)).toBe('in-progress');
    expect(courseProgress(empty)).toBe(0);
  });
});

describe('filterCourses', () => {
  const base: CourseFilters = { query: '', state: 'all', sort: 'name' };
  const ids = (filters: Partial<CourseFilters>) =>
    filterCourses(courses, { ...base, ...filters }).map(({ id }) => id);

  it('searches the title and the description regardless of case', () => {
    expect(ids({ query: 'git' })).toEqual(['Git']);
    expect(ids({ query: '  CACHING ' })).toEqual(['HTTP']);
    expect(ids({ query: 'nothing like this' })).toEqual([]);
  });

  it('filters by the derived state and combines it with the query', () => {
    expect(ids({ state: 'in-progress' })).toEqual(['Git']);
    expect(ids({ state: 'not-started' })).toEqual(['HTTP']);
    expect(ids({ state: 'completed', query: 'git' })).toEqual([]);
  });

  it('sorts by progress or due reviews, highest first, ties by name', () => {
    expect(ids({ sort: 'progress' })).toEqual(['SQL', 'Git', 'HTTP']);
    expect(ids({ sort: 'due' })).toEqual(['SQL', 'Git', 'HTTP']);
  });

  it('does not reorder the source list', () => {
    ids({ sort: 'progress' });
    expect(courses.map(({ id }) => id)).toEqual(['Git', 'HTTP', 'SQL']);
  });
});

describe('recommendCourse', () => {
  it('prefers the course with the most due reviews among open ones', () => {
    // SQL пройден и не предлагается, хотя у него больше всего повторений
    expect(recommendCourse(courses)).toBe('Git');
  });

  it('without due reviews takes the most recently practised, then the first not started', () => {
    const quiet = [
      course('A', { attempts: 1, lastAttemptAt: 10 }),
      course('B', { attempts: 1, lastAttemptAt: 20 }),
      course('C'),
    ];
    expect(recommendCourse(quiet)).toBe('B');
    expect(recommendCourse([course('C'), course('D')])).toBe('C');
  });

  it('offers nothing when no course is open', () => {
    expect(
      recommendCourse([sql, course('L', { status: 'locked' })]),
    ).toBeNull();
    expect(recommendCourse([])).toBeNull();
  });
});
