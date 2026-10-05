import type { ru } from './ru.ts';

export const en: typeof ru = {
  courseUpdates: {
    banner: {
      text: 'Course update available: {courses}',
      update: 'Update',
      updateLabel: 'Update courses from {repository}',
    },
    notice: {
      text: 'Course update available: {courses}',
      open: 'Go to courses',
      close: 'Close',
    },
    check: {
      label: 'Check for updates',
      found: 'No updates | Found {n} update | Found {n} updates',
      upToDate: 'All courses are up to date',
      unreachable:
        'Could not reach the course server. Check your network connection.',
    },
  },
};
