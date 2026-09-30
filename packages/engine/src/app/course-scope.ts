import type { UnitId } from '@spirula-app/engine-contract';
import type { Library } from '../domain/library.ts';
import { EngineError } from './errors.ts';

/** Область курсов запроса: принадлежит ли урок одному из выбранных курсов. */
export interface CourseScope {
  hasLesson(lessonId: UnitId): boolean;
}

/**
 * `courseIds` запроса → область курсов. Пусто или нет поля — `null` (все
 * курсы, как в `PlacementStartRequest`); неизвестный курс — `NOT_FOUND`.
 */
export const resolveCourseScope = (
  library: Library,
  courseIds: readonly UnitId[] | undefined,
): CourseScope | null => {
  if (courseIds === undefined) return null;
  if (!Array.isArray(courseIds)) {
    throw new EngineError('INVALID_ARGUMENT', { details: { courseIds } });
  }
  for (const courseId of courseIds) {
    if (library.getCourse(courseId) === undefined) {
      throw new EngineError('NOT_FOUND', { details: { courseId } });
    }
  }
  if (courseIds.length === 0) return null;
  const courses = new Set(courseIds);
  return {
    hasLesson: (lessonId) => {
      const courseId = library.graph.getLessonCourse(lessonId);
      return courseId !== undefined && courses.has(courseId);
    },
  };
};
