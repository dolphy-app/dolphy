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
        shortcuts: 'Keyboard shortcuts',
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
        grading: 'Grading',
        experimental: 'Experimental',
      },
      gradePolicy: {
        title: 'Grade rule',
        description:
          'How the results of answer checks turn into a grade from 1 to 5.',
        builtin: 'Built-in',
        passAtN: {
          title: "Pass{'@'}N",
          description:
            'Correct on the first try — 5, on the second — 4, on the third or later — 3, “Give up” — 1. Check failures are not counted.',
        },
        missing:
          "The selected rule “{id}” is unavailable: its extension was not found. Pass{'@'}N applies for now.",
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
      repositories: {
        title: 'Repositories',
        description:
          'Courses from Git. Updating and removing happen only on your command; the app never uses the network on its own.',
        empty: 'No repositories yet. Add one on the Courses screen.',
        defaultBranch: 'default branch',
        courses: 'no courses | {n} course | {n} courses',
        update: 'Update',
        updateLabel: 'Update repository {url}',
        remove: 'Remove',
        removeLabel: 'Remove repository {url}',
        cancelling: 'Cancelling…',
        notice: {
          upToDate: 'Already up to date',
          updated:
            'Updated: no courses | Updated: {n} course | Updated: {n} courses',
          removed: 'Repository removed',
        },
        confirm: {
          title: 'Remove the repository?',
          text: 'Its courses will disappear from the library. Your progress is kept and comes back if you add the repository again.',
        },
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
    shortcuts: {
      title: 'Keyboard shortcuts',
      subtitle: 'Keys that run app commands.',
      palette: {
        title: 'Command palette',
        description:
          'The command palette searches the commands of the app and of extensions.',
        open: 'Open command palette',
      },
      empty: 'There are no keyboard shortcuts yet.',
      noCategory: 'Other',
      columns: {
        command: 'Command',
        keys: 'Shortcut',
      },
      note: 'Shortcuts are set by the app and cannot be changed yet.',
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
      moreValues: '{n} more',
      fewerValues: 'Show less',
      points: {
        exerciseTypes: 'Exercise types',
        themes: 'Themes',
        markdownRenderers: 'Content renderers',
        gradePolicies: 'Grade policies',
        settings: 'Settings',
        events: 'Learning events',
        commands: 'Commands',
        panels: 'Panels',
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
        disabled: 'Disabled',
      },
      builtIn: 'Built in',
      isolation: {
        isolated: 'Isolated',
        trusted: 'Trusted',
      },
      enabledLabel: 'Enabled',
      trustLabel: 'Trust (no isolation)',
      trustHint:
        'A trusted extension runs without isolation: its code runs with the app’s rights and its elements live in the app window and can see its data. Trust only extensions you believe in.',
      permissionsTitle: 'Permissions',
      permissionsNone: 'none requested',
      permissions: {
        learning: { events: 'Learning events' },
        library: { read: 'Read the course library' },
        process: { spawn: 'Launch processes' },
        worker: { threads: 'Threads' },
        native: { addons: 'Native modules' },
        network: 'Network',
      },
      networkCaveat:
        'Network is declared only, not restricted: the extension can reach the network even when isolated.',
      switchFailed: 'Could not change the extension setting',
      reload: {
        message: 'The update will apply after the window is reloaded',
        action: 'Reload window',
      },
      tabs: {
        label: 'Extension sections',
        installed: 'Installed',
        catalog: 'Catalog',
      },
      author: 'Author',
      action: {
        install: 'Install',
        installLabel: 'Install extension “{name}” v{version}',
        update: 'Update to v{version}',
        updateLabel: 'Update to v{version}: extension “{name}”',
        installDisabledLabel: 'Install extension “{name}”',
        installFallback: 'Install v{version} (compatible)',
        installFallbackLabel:
          'Install v{version} (compatible): extension “{name}”',
        remove: 'Remove',
        removeLabel: 'Remove extension “{name}”',
        settings: 'Settings',
        settingsLabel: 'Settings of extension “{name}”',
      },
      installed: {
        fromCatalog: 'From the catalog v{version}',
        updatesBanner: 'Updates available: {n}',
        updateAll: 'Update all',
        checkUpdates: 'Check for updates at startup',
        revokedTitle: 'Extension revoked',
        revokedReason: 'Reason: {reason}',
        revokedHint:
          'It is disabled and stays disabled until a fixed version is released.',
      },
      remove: {
        title: 'Remove “{name}”?',
        text: 'The extension will be deleted from disk. Your courses and progress are not affected.',
        removeData: 'Delete the extension’s data',
        removeDataHint:
          'Its storage and setting values will be erased. If left unchecked they stay and come back when the extension is installed again.',
        confirm: 'Remove',
        cancel: 'Cancel',
        failed: 'Could not remove the extension',
      },
      data: {
        title: 'Data',
        usage: '{keys}, {size}',
        keys: 'no keys | {n} key | {n} keys',
        clear: 'Clear data',
        clearLabel: 'Clear data of extension “{name}”',
        confirmTitle: 'Clear the data of “{name}”?',
        confirmText:
          'The extension’s storage and setting values will be erased: the extension will see an empty storage and default settings. The extension itself, your courses and your progress are not affected.',
        confirm: 'Clear',
        cancel: 'Cancel',
        failed: 'Could not clear the data',
      },
      settingsDialog: {
        title: 'Settings of “{name}”',
        loadFailed: 'Could not load the settings',
        retry: 'Retry',
        reset: 'Reset',
        resetFailed: 'Could not reset the settings',
        close: 'Close',
        hintRange: 'From {min} to {max}',
        hintMin: 'At least {min}',
        hintMax: 'At most {max}',
        problems: {
          type: 'This value does not fit the setting.',
          integer: 'A whole number is required.',
          range: 'The number is out of range.',
          'max-length': 'The value is too long.',
          option: 'This option is not in the list.',
          'unknown-setting': 'The extension no longer declares this setting.',
          'not-a-number': 'Enter a number.',
        },
      },
      catalog: {
        listLabel: 'Catalog extensions',
        searchLabel: 'Search the catalog',
        searchHint: 'Name, id, description or author',
        kindsLabel: 'Filter by contribution kind',
        refresh: 'Refresh catalog',
        resetFilters: 'Reset filters',
        found: 'nothing found | Found: {n} extension | Found: {n} extensions',
        loading: 'Loading the catalog',
        empty: 'The catalog has no extensions yet.',
        noMatches: 'Nothing found. Change the query or reset the filters.',
        offline: 'No connection to the catalog. Showing saved data',
        reason: 'Reason: {reason}',
        fetchedAt: 'Catalog data from {date}',
        unavailable: 'The catalog is unavailable',
        incompatible: 'Incompatible: {detail}',
        installedStatus: 'Installed v{version}',
        installedFrom: 'Now v{version}',
      },
      install: {
        titleInstall: 'Install “{name}”?',
        titleUpdate: 'Update “{name}”?',
        titleUpdateAll:
          'nothing to update | Update {n} extension? | Update {n} extensions?',
        titleRunning: 'Installing',
        titleFinished: 'Installation finished',
        titleFailed: 'Installation failed',
        versionChange: 'v{from} → v{to}',
        platforms: 'Platforms',
        size: 'Size',
        isolation:
          'The extension will run in isolation: its code and interface are separated from the app.',
        confirmInstall: 'Install',
        confirmUpdate: 'Update',
        cancel: 'Cancel',
        progress: 'Installing',
        itemStatus: {
          pending: 'Waiting',
          running: 'Installing',
          done: 'Done',
          failed: 'Failed',
        },
        done: 'Installed. The extension is already working.',
        partial: 'Some extensions were installed and are already working.',
        close: 'Close',
        retry: 'Retry',
        errors: {
          network: 'Could not download the extension. Check your connection.',
          integrity:
            'The extension files failed the integrity check. Nothing was installed.',
          incompatible:
            'The extension is not compatible with this app version or platform.',
          limits: 'The extension exceeds the allowed size limits.',
          invalid:
            'The extension failed validation: its files do not match the catalog entry.',
          conflict:
            'A directory with this name already exists and was not created from the catalog. Remove it manually.',
          unavailable: 'The catalog is unavailable. Check your connection.',
          notFound: 'The extension is not in the catalog.',
          unknown: 'Could not install the extension.',
        },
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
