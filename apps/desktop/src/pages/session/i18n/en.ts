import type { ru } from './ru.ts';

export const en: typeof ru = {
  session: {
    title: 'Session',
    topBar: {
      exit: 'Exit session',
      pause: 'Pause',
      progress: 'Session progress',
      time: 'Time',
      undo: 'Undo the last answer',
      redo: 'Redo the undone answer',
    },
    empty: {
      title: 'Nothing to practice today',
      text: 'Your plan has no exercises: everything is done, or the library has no courses yet.',
    },
    toPlan: 'Back to daily plan',
    finished: {
      title: 'Session complete',
      count: 'Exercises',
      passed: 'Passed',
      averageGrade: 'Average grade',
      time: 'Time',
    },
    actions: {
      next: 'Next',
      finish: 'Finish',
    },
    grade: 'Grade: {grade}',
    gaveUp: 'This attempt was counted as “not solved”.',
    remediation: {
      title: 'Review the basics',
      text: 'Go back to these topics: {lessons}.',
    },
    pause: {
      title: 'Paused',
      text: 'The timer is stopped. Come back when you are ready.',
      resume: 'Resume',
    },
  },
};
