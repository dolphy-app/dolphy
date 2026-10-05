import type { ru } from './ru.ts';

export const en: typeof ru = {
  tour: {
    label: 'Guided tour',
    offer: {
      title: 'Take a quick tour?',
      text: 'A minute: we will show where the daily plan, courses and settings are, and explain what “In focus” means. You can skip it and take it later: “Settings → About the engine”.',
      start: 'Start',
      skip: 'Skip',
    },
    card: {
      progress: 'Step {n} of {total}',
      announce: 'Step {n} of {total}: {title}',
      back: 'Back',
      next: 'Next',
      done: 'Done',
      skip: 'Skip tour',
    },
    replay: {
      title: 'Guided tour',
      text: 'We will show the main places of the app and explain what “In focus” means.',
      button: 'Take the tour again',
    },
    welcome: {
      intro: {
        title: 'How it works',
        text: 'Dolphy builds your daily plan from reviews and new material: it tells you what is due. A quick look at where things are.',
      },
      plan: {
        title: 'Daily plan',
        text: 'Everything for today: reviews and new material in one list. Start a session from here, the rest adjusts itself.',
      },
      scope: {
        title: 'One course or all at once',
        text: 'Pick a course and the plan, reviews and session take exercises only from it. “All courses” brings the shared plan back. Each course keeps its own progress.',
      },
      card: {
        title: 'Course card',
        text: '“In focus” means you are studying this course: exercises come only from it. “Recommended” suggests where to start. Progress is the share of mastered lessons.',
      },
      check: {
        title: 'Check what I already know',
        text: 'A placement test for the course: it finds out what you already know, so the plan does not make you repeat it.',
      },
      git: {
        title: 'Add courses',
        text: 'Courses come from a Git repository: paste the address and they appear in the catalog. “View knowledge graph” on a card shows how its lessons are connected.',
      },
      settings: {
        title: 'Settings',
        text: 'Keyboard shortcuts, extensions, appearance. The command palette opens with Ctrl+K (⌘K on macOS). You can repeat this tour: “Settings → About the engine”.',
      },
    },
  },
};
