export {
  COURSE_UPDATES_KEY,
  createCourseUpdates,
} from './model/course-updates.ts';
export type {
  CourseUpdateFailure,
  CourseUpdates,
} from './model/course-updates.ts';
export { useCourseUpdates } from './model/use-course-updates.ts';
export { default as CheckUpdatesButton } from './ui/CheckUpdatesButton.vue';
export { default as CourseUpdatesBanner } from './ui/CourseUpdatesBanner.vue';
export { default as CourseUpdatesSnackbar } from './ui/CourseUpdatesSnackbar.vue';
export { messages as courseUpdatesMessages } from './i18n';
