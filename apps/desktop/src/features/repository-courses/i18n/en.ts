import type { ru } from './ru.ts';

export const en: typeof ru = {
  repositoryCourses: {
    label: 'Repository courses',
    selected: '{n} of {total} selected',
    selectAll: 'Select all',
    clear: 'Clear all',
    installed: 'Installed',
    warnings: 'no warnings | {n} warning | {n} warnings',
    lessons: 'no lessons | {n} lesson | {n} lessons',
    requires: 'Also needs: {names}',
    requiredBy: 'Needed by: {names}',
    block: {
      errors: 'This course cannot be added: it has errors ({n}).',
      inLibrary: 'A course with this id is already in the library.',
      requiresBlocked: 'It needs a course that cannot be added.',
    },
  },
};
