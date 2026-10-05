import { inject } from 'vue';
import { COURSE_UPDATES_KEY } from './course-updates.ts';
import type { CourseUpdates } from './course-updates.ts';

export const useCourseUpdates = (): CourseUpdates => {
  const updates = inject(COURSE_UPDATES_KEY);
  if (!updates) throw new Error('course updates are not provided');
  return updates;
};
