import type { ru } from './ru.ts';

export const en: typeof ru = {
  session: {
    title: 'Session',
    topBar: {
      exit: 'Exit session',
      pause: 'Pause',
      progress: 'Session progress',
      time: 'Time',
    },
    material: 'Lesson material · {course}',
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
    answer: {
      sqlLabel: 'SQL query',
      label: 'Answer',
      hint: 'Ctrl/⌘ + Enter to check',
      title: 'Answer',
    },
    actions: {
      check: 'Check',
      giveUp: 'Give up',
      reveal: 'Show answer',
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
    selfGrade: {
      title: 'How well do you remember this?',
      options: {
        1: 'Forgot',
        2: 'Barely',
        3: 'Recalled',
        4: 'Good',
        5: 'Easy',
      },
    },
    verdict: {
      passed: 'Correct',
      failed: 'Not correct yet',
      error: 'Could not check your answer',
      errorRetry: '{reason} Your attempt was not lost — please submit again.',
      failedReason: {
        mismatch: 'The result does not match the expected one.',
        sql_error: 'The query failed with an error.',
        forbidden: 'The query uses a forbidden operation.',
        row_limit: 'The query returned too many rows.',
        byte_limit: 'The query result is too large.',
        sqlite_limit: 'The query exceeded an SQLite limit.',
      },
      errorReason: {
        fixture_error: 'This exercise is misconfigured.',
        expected_error: 'This exercise is misconfigured.',
        internal: 'Internal checking error.',
        timeout: 'Checking took too long.',
        resource_kill: 'Checking was stopped: resource limits exceeded.',
        worker_crash: 'The checking process crashed.',
      },
    },
  },
};
