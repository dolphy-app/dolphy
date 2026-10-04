import type { ru } from './ru.ts';

export const en: typeof ru = {
  nav: {
    main: 'Main menu',
    more: 'More',
    dailyPlan: "Today's plan",
    courses: 'Courses',
    graph: 'Knowledge graph',
    settings: 'Settings',
    extensions: 'Extension panels',
  },
  safeMode: {
    banner: {
      persisted:
        'Safe mode: all extensions except the built-in ones are turned off. Courses and progress work as usual.',
      flag: 'Safe mode is on because of the --safe-mode launch flag. To get your extensions back, start the app without it.',
      env: 'Safe mode is on because of the DOLPHY_SAFE_MODE environment variable. To get your extensions back, remove it and start the app again.',
      disable: 'Turn off safe mode',
      failed: 'Could not turn off safe mode',
    },
  },
  startup: {
    updateTitle: 'Update the app',
    updateText:
      'The interface version does not match the learning engine version.',
    failedTitle: 'Could not connect to the engine',
  },
};
