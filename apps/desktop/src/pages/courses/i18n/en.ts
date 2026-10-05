import type { ru } from './ru.ts';

export const en: typeof ru = {
  courses: {
    title: 'Courses',
    subtitle: 'Study one course at a time, or all of them together',
    search: 'Search by title and description',
    clearFocus: 'Show all courses',
    filter: {
      state: 'Status',
      sort: 'Sort',
    },
    state: {
      all: 'All statuses',
      'not-started': 'Not started',
      'in-progress': 'In progress',
      completed: 'Completed',
      locked: 'Locked by prerequisites',
      hidden: 'Hidden',
      superseded: 'Superseded',
    },
    sort: {
      name: 'By title',
      progress: 'By progress',
      due: 'By due reviews',
    },
    card: {
      lessons: 'no lessons | {n} lesson | {n} lessons',
      attempts: 'no attempts | {n} attempt | {n} attempts',
      lessonsDone: 'Lessons completed: {done} of {total}',
      due: 'no reviews due | {n} review due | {n} reviews due',
      focused: 'In focus',
      recommended: 'Recommended',
      study: 'Study',
      openPlan: 'Course plan',
      check: 'Check what I already know',
      graph: 'View knowledge graph',
    },
    git: {
      open: 'Add from Git',
      title: 'Add courses from Git',
      description:
        'Courses from a public repository will appear in the catalog. The network is used only now and when you update the repository.',
      url: 'Repository URL',
      urlPlaceholder: 'https://github.com/author/course',
      ref: 'Branch or tag',
      refHint: 'Empty — the default branch',
      submit: 'Add',
      next: 'Next',
      back: 'Back',
      chooseTitle: 'Choose courses',
      chooseDescription:
        'The repository {url} has several courses. Select the ones you need: the others will not be loaded into the library.',
      close: 'Close',
      cancelling: 'Cancelling…',
      moreMessages: 'and {n} more',
      added: 'No courses added | {n} course added | {n} courses added',
    },
    empty: {
      title: 'No courses yet',
      text: 'Add courses from Git, or put them in the library and reload it in Settings → Library.',
    },
    noMatches: {
      title: 'Nothing found',
      text: 'Change the query or reset the status filter.',
    },
  },
};
