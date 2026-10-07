import type { ru } from './ru.ts';

export const en: typeof ru = {
  tour: {
    label: 'Guided tour',
    offer: {
      title: 'Take a quick tour?',
      text: 'A minute: we will show the course knowledge check and the main settings tabs. You can skip it and take it later: “Settings → About the engine”.',
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
      text: 'We will show the course knowledge check and the main settings tabs.',
      button: 'Take the tour again',
    },
    welcome: {
      intro: {
        title: 'How it works',
        text: 'Dolphy builds your daily plan from reviews and new material: it tells you what is due. A quick look at what is worth knowing from day one.',
      },
      check: {
        title: 'Check what I already know',
        text: 'A placement test for the course: it finds out what you already know, so the plan does not make you repeat it.',
      },
      learning: {
        title: 'Learning',
        text: 'This is where you tune how Dolphy picks reviews and new material: the daily plan, sessions, reinforcing the basics and grading. Parameters that are not obvious have a “?” icon: hover it. You rarely need to change anything.',
      },
      retention: {
        title: 'Target retention',
        text: 'The main plan parameter. Dolphy estimates the chance you will recall an exercise and puts it up for review when that drops below this threshold. Higher means more reviews, lower is calmer.',
      },
      remediation: {
        title: 'Reinforcing the basics',
        text: 'If an exercise keeps failing, exercises for its prerequisites, the topics it rests on, are added to the plan. Here you set how many failures trigger it and how many exercises to add.',
      },
      grade: {
        title: 'Grade rule',
        text: "How an answer check becomes a grade from 1 to 5. The built-in Pass{'@'}N reads “passed on attempt N”: the earlier the answer is right, the higher the grade and the later the review. Extensions bring other rules.",
      },
      library: {
        title: 'Library',
        text: 'Where the courses live, how many lessons and exercises they have, which folders the engine skips. Git repositories are here too: update courses from the server or remove them.',
      },
      extensions: {
        title: 'Extensions',
        text: 'Extensions live here, in “Settings → Extensions”: there is no separate item in the side menu. They add exercise types, themes, commands and panels (panels appear in the side menu). Install them from the catalog, turn them on and configure them.',
      },
      settings: {
        title: 'Keyboard shortcuts',
        text: 'All commands of the app and extensions with their shortcuts, which you can change. The command palette opens with Ctrl+K (⌘K on macOS). You can repeat this tour: “Settings → About the engine”.',
      },
    },
  },
};
