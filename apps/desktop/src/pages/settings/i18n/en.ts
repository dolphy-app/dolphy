import type { ru } from './ru.ts';

export const en: typeof ru = {
  settings: {
    page: {
      title: 'Settings',
      navLabel: 'Settings sections',
      nav: {
        learning: 'Learning',
        library: 'Library',
        appearance: 'Appearance',
        extensions: 'Extensions',
        about: 'About the engine',
      },
    },
    learning: {
      title: 'Learning',
      subtitle: 'How the scheduler builds your daily plan and study sessions.',
      groups: {
        plan: 'Daily plan',
        sessions: 'Sessions',
        remediation: 'Reinforcing the basics',
        experimental: 'Experimental',
      },
      targetRetention: {
        title: 'Target retention',
        description:
          'How confidently you should remember the material by the time it is reviewed. Higher means more reviews.',
      },
      newFraction: {
        title: 'Share of new material',
        description:
          'At least this share of the plan is made up of exercises you have not done yet.',
      },
      sameCourseRun: {
        title: 'In a row from one course',
        description:
          'How many exercises from the same course can appear in a row.',
      },
      tagDistance: {
        title: 'Gap between similar topics',
        description: 'How many exercises must separate tasks that share tags.',
      },
      batchSize: {
        title: 'Batch size',
        description: 'How many exercises the scheduler picks per request.',
      },
      lessonsInProgress: {
        title: 'Lessons in progress',
        description:
          'How many lessons you can study at once before new ones unlock.',
      },
      failThreshold: {
        title: 'Failure threshold',
        description:
          'How many failures on an exercise trigger reinforcement of the basics.',
      },
      remediationItems: {
        title: 'Reinforcement exercises',
        description:
          'At most this many prerequisite exercises are added to the plan.',
      },
      implicitCredit: {
        title: 'Implicit reviews',
        description:
          'Reviewing a hard topic also counts for the simpler ones inside it. The effect has only been measured on the model.',
      },
      actions: {
        revert: 'Discard',
        reset: 'Reset to defaults',
      },
      resetDialog: {
        title: 'Reset settings?',
        text: 'All learning parameters will return to their default values.',
        confirm: 'Reset',
      },
    },
    library: {
      title: 'Library',
      subtitle: 'Where your courses live and which folders the engine skips.',
      state: {
        title: 'Status',
        ready: 'Ready',
        failed: 'Has errors',
      },
      reload: 'Reload',
      counts: {
        courses: 'Courses',
        lessons: 'Lessons',
        exercises: 'Exercises',
      },
      diagnostics: {
        errors: 'Errors: {n}',
        warnings: 'Warnings: {n}',
        clean: 'No issues',
      },
      artifact: {
        label: 'Course cache: {state}',
        fresh: 'up to date',
        stale: 'outdated',
        missing: 'none',
        compiling: 'building',
      },
      ignored: {
        title: 'Ignored folders',
        description:
          'Paths inside the library that the engine does not read: drafts, nested copies.',
        fieldLabel: 'Path from the library root',
        placeholder: 'drafts/old',
        empty: 'Nothing is ignored.',
        apply: 'Apply and reload',
        revert: 'Discard',
      },
    },
    appearance: {
      title: 'Appearance',
      subtitle: 'Theme and language apply immediately.',
      theme: {
        title: 'Theme',
        description:
          'Look of the interface. “System default” follows the OS setting.',
        label: 'Color theme',
        system: 'System default',
        light: 'Light',
        dark: 'Dark',
      },
      language: {
        title: 'Language',
        description:
          'Language of menus and hints. Course and exercise titles are not translated.',
        label: 'Interface language',
        system: 'System default',
        ru: 'Русский',
        en: 'English',
      },
    },
    extensions: {
      title: 'Extensions',
      subtitle: 'What extensions add: bundled, your own and in development.',
      listLabel: 'Installed extensions',
      count: 'no extensions | {n} extension | {n} extensions',
      refresh: 'Refresh',
      retry: 'Retry',
      loadFailed: 'Could not load the list of extensions',
      empty: 'No extensions.',
      version: 'Version {version}',
      points: {
        exerciseTypes: 'Exercise types',
        themes: 'Themes',
        markdownRenderers: 'Content renderers',
        gradePolicies: 'Grade policies',
      },
      origin: {
        bundled: 'Bundled',
        user: 'User',
        dev: 'Development',
      },
      state: {
        loaded: 'Loaded',
        overridden: 'Overridden',
        invalid: 'Failed to load',
      },
    },
    about: {
      title: 'About the engine',
      subtitle:
        'Version, database status and the memory model behind your reviews.',
      engine: {
        title: 'Engine',
        version: 'Engine version',
        contractVersion: 'Contract version',
        uptime: 'Uptime',
        entryCount: 'Log entries',
        dbSize: 'Database size',
      },
      scorer: {
        title: 'Memory model',
        memoryModel: 'Memory model',
        kind: 'Scoring type',
        ratingMap: 'Attempt ratings',
        numTrials: 'Attempts per rating',
        parameters: 'Parameters',
      },
      ratingMap: {
        runner: 'from the check result',
        anki: 'Anki-style',
      },
    },
  },
};
