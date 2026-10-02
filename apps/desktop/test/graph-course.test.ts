import { describe, expect, it } from 'vitest';
import type { CourseSummary } from '@/entities/course';
import { pickGraphCourse } from '@/pages/graph/lib/course.ts';

const course = (
  id: string,
  patch: Partial<CourseSummary> = {},
): CourseSummary => ({
  id,
  name: id,
  lessonCount: 3,
  lessonsDone: 0,
  status: 'ready',
  attempts: 0,
  due: 0,
  ...patch,
});

describe('курс графа', () => {
  const courses = [
    course('a'),
    course('b', { lastAttemptAt: 100 }),
    course('c', { lastAttemptAt: 300 }),
  ];

  it('выбранный курс остаётся как есть', () => {
    expect(pickGraphCourse(courses, 'a')).toBe('a');
  });

  it('без выбора берёт курс с самой свежей попыткой', () => {
    expect(pickGraphCourse(courses, null)).toBe('c');
  });

  it('без выбора и без попыток берёт первый курс', () => {
    expect(pickGraphCourse([course('x'), course('y')], null)).toBe('x');
  });

  it('выбор пропавшего курса не оставляет граф пустым', () => {
    expect(pickGraphCourse(courses, 'gone')).toBe('c');
  });

  it('пустая библиотека — нет курса', () => {
    expect(pickGraphCourse([], null)).toBeNull();
  });
});
