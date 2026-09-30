import { inject } from 'vue';
import { COURSE_SCOPE_KEY } from './course-scope.ts';
import type { CourseScope } from './course-scope.ts';

export const useCourseScope = (): CourseScope => {
  const scope = inject(COURSE_SCOPE_KEY);
  if (!scope) throw new Error('course scope is not provided');
  return scope;
};
