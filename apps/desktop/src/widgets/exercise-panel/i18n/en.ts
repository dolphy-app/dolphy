import type { ru } from './ru.ts';

export const en: typeof ru = {
  exercisePanel: {
    material: 'Lesson material · {course}',
    splitter: {
      label: 'Theory panel width',
      hint: 'Drag to resize; double-click to reset',
    },
    panel: {
      hide: 'Hide theory',
      show: 'Show theory',
    },
    sections: {
      button: 'Sections',
      label: 'Lesson sections',
    },
    answer: {
      frameTitle:
        'Answer input from an extension in an isolated frame: {label}',
      loadFailed: 'Could not load the answer input ({element}).',
      label: 'Answer',
      hint: 'Ctrl/⌘ + Enter to check',
      title: 'Answer',
    },
    actions: {
      check: 'Check',
      giveUp: 'Give up',
      reveal: 'Show answer',
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
        invalid_answer: 'The answer does not fit the exercise.',
      },
      errorReason: {
        fixture_error: 'This exercise is misconfigured.',
        expected_error: 'This exercise is misconfigured.',
        invalid_spec: 'This exercise is misconfigured.',
        internal: 'Internal checking error.',
        timeout: 'Checking took too long.',
        resource_kill: 'Checking was stopped: resource limits exceeded.',
        worker_crash: 'The checking process crashed.',
      },
    },
  },
};
