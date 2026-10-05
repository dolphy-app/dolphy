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
          removedWithProgress: 'Repository and progress removed',
        },
        confirm: {
          title: 'Remove the repository?',
          text: 'Its courses will disappear from the library.',
          removeProgress: 'Also delete the progress of its courses',
          keepHint:
            'Your progress is kept and comes back if you add the repository again.',
          resetHint:
            'Attempts and scores of these courses will be reset, including on your other devices after sync.',
        },
        notInstalled:
          'none not installed | {n} course not installed | {n} courses not installed',
        choose: 'Courses…',
        chooseLabel: 'Choose courses of repository {url}',
        chooser: {
          title: 'Courses of the repository',
          hint: 'Checked courses are in the library. Applying downloads the repository again; your progress is kept for courses you remove.',
          apply: 'Apply',
          close: 'Close',
        },
      },
      transfers: {
        title: 'Import and export',
        description:
          'Extensions turn a file into a course and export a course or progress into a file. You choose the file and where to save it in the system dialog; extensions never see paths.',
        empty:
          'No extensions with import or export. They appear here once installed and enabled.',
        importers: 'Import',
        exporters: 'Export',
        import: 'Import…',
        export: 'Export…',
        importLabel: 'Import: {title}',
        exportLabel: 'Export: {title}',
        scope: { course: 'course', progress: 'progress' },
        accept: 'Files: {accept}',
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
      subtitle:
        'Keys of app and extension commands: change, add, remove or reset a shortcut.',
      palette: {
        title: 'Command palette',
        description: 'The command palette searches app and extension commands.',
        open: 'Open command palette',
      },
      toolbar: {
        label: 'Search and filters',
        search: 'Search commands',
        searchHint: 'Title, category, keys or command key',
        changed: 'Changed',
        conflicts: 'Conflicts only',
        resetAll: 'Reset all',
      },
      empty: 'No commands yet.',
      noMatches: 'Nothing found.',
      noCategory: 'Other',
      columns: {
        command: 'Command',
        keys: 'Shortcuts',
        when: 'Condition',
        source: 'Source',
        actions: 'Actions',
      },
      none: 'No shortcuts',
      always: 'always',
      source: {
        default: 'App',
        extension: 'Extension',
        user: 'Yours',
      },
      conflict: {
        badge: 'Conflict',
        same: {
          wins: 'Overlaps with “{other}” ({keys}): this command wins.',
          loses: 'Overlaps with “{other}” ({keys}): “{other}” wins.',
        },
        prefix: {
          wins: 'Chord start matches “{other}” ({keys}): this command wins.',
          loses: 'Chord start matches “{other}” ({keys}): “{other}” wins.',
        },
      },
      actions: {
        edit: 'Edit shortcut {keys}: {title}',
        remove: 'Remove shortcut {keys}: {title}',
        add: 'Add shortcut: {title}',
        reset: 'Reset shortcuts: {title}',
      },
      resetAll: {
        title: 'Reset all shortcuts?',
        text: 'Your changes will be discarded: commands get the shortcuts of the app and extensions back.',
        confirm: 'Reset',
        cancel: 'Cancel',
      },
      dialog: {
        titleEdit: 'Edit shortcut: {title}',
        titleAdd: 'Add shortcut: {title}',
        capture: 'Shortcut',
        captureHelp:
          'Press the keys. A second combination continues the chord (two at most). Backspace or Delete clears the recording, Escape with nothing recorded closes the dialog.',
        captureEmpty: 'Press keys…',
        recorded: 'Recorded: {keys}',
        clear: 'Clear recording',
        when: 'Condition (when)',
        whenHint:
          'Empty means always. Keys: {keys}. Operators: {operators}, parentheses.',
        conflictsTitle: 'Conflicts',
        noConflicts: 'No conflicts.',
        overrides: 'Your shortcut will win.',
        blocking:
          'This is your own shortcut of another command: “Reassign” removes it there.',
        save: 'Save',
        reassign: 'Reassign',
        cancel: 'Cancel',
      },
      problems: {
        key: 'Invalid key text: {reason}.',
        when: 'Condition error at position {position}: {reason}.',
        typing:
          'A shortcut without Ctrl or ⌘ types a character: set a condition that is false while typing, for example !inputFocus.',
        duplicate: 'The command already has this shortcut with this condition.',
        reason: {
          empty: 'empty',
          'empty-part': 'empty part',
          'too-long': 'text is too long',
          'too-long-text': 'text is too long',
          'too-deep': 'nesting is too deep',
          'modifier-only': 'a modifier without a key',
          'unknown-modifier': 'unknown modifier',
          'repeated-modifier': 'repeated modifier',
          'unknown-key': 'unknown key',
          'invalid-code': 'invalid physical key code',
          'unexpected-token': 'unexpected character',
          'unexpected-end': 'unexpected end',
          'unterminated-string': 'unclosed quote',
        },
      },
      failed: {
        syntax: 'The engine rejected the entry ({field}): {message}',
        typing: 'The engine rejected the entry ({field}): {message}',
        conflict:
          'The shortcut overlaps another command of your set: “{command}” and “{other}”. Use “Reassign”.',
        limit: 'Limit exceeded: {message}',
        duplicate: 'Repeated shortcut and condition ({field}).',
        unknown: 'Shortcuts were not saved: {message}',
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
      moreValues: '{n} more',
      fewerValues: 'Show less',
      tagsLabel: 'Tags',
      tags: {
        learning: 'Learning',
        language: 'Languages',
        content: 'Content',
        theme: 'Theme',
        interface: 'Interface',
        productivity: 'Productivity',
        developer: 'For developers',
      },
      groups: {
        learning: 'Learning',
        appearance: 'Appearance and interface',
        developers: 'For developers',
      },
      events: {
        sessionStarted: 'Session start',
        sessionFinished: 'Session end',
        attemptClosed: 'Attempt closed',
      },
      points: {
        exerciseTypes: 'Exercise types',
        themes: 'Themes',
        markdownRenderers: 'Content renderers',
        gradePolicies: 'Grade policies',
        settings: 'Settings',
        events: 'Learning events',
        commands: 'Commands',
        panels: 'Panels',
        widgets: 'Widgets',
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
        'dependencies-unmet': 'Dependencies not met',
      },
      builtIn: 'Built in',
      isolation: {
        isolated: 'Isolated',
        trusted: 'Trusted',
      },
      enabledLabel: 'Enabled',
      notificationsLabel: 'Notifications',
      schedulesLabel: 'Schedule',
      schedule: {
        daily: 'Every day at {at}',
        hourly: 'Every hour',
      },
      trustLabel: 'Trust (no isolation)',
      trustHint:
        'A trusted extension runs without isolation: its code runs with the app’s rights and its elements live in the app window and can see its data. Trust only extensions you believe in.',
      dependencies: {
        title: 'Dependencies',
        status: {
          ok: 'loaded',
          installed: 'installed',
          missing: 'not installed',
          disabled: 'disabled',
          version: 'version does not fit',
          unmet: 'not loaded',
        },
        hint: 'Dependencies are not installed automatically: install them yourself. Installing this extension is not blocked — it starts working once its dependencies are met.',
      },
      permissionsTitle: 'Permissions',
      permissionsNone: 'none requested',
      permissions: {
        learning: {
          events: 'Learning events',
          stats: 'Learning statistics',
        },
        library: { read: 'Read the course library' },
        process: { spawn: 'Launch processes' },
        worker: { threads: 'Threads' },
        native: { addons: 'Native modules' },
        network: 'Network',
        notifications: 'System notifications',
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
        elsewhere: 'Already installed from another source',
        elsewhereLabel:
          'Install extension “{name}”: already installed from another source',
        elsewhereHint:
          'To install it from this catalog, remove the installed extension first.',
        remove: 'Remove',
        removeLabel: 'Remove extension “{name}”',
        settings: 'Settings',
        settingsLabel: 'Settings of extension “{name}”',
      },
      diagnostic: {
        'manifest-unreadable': 'Could not read extension.json: {reason}',
        'manifest-invalid': 'The manifest is invalid:',
        'id-mismatch':
          'The directory name “{expected}” does not match the manifest id “{actual}”',
        'requires-app': 'Requires app version {minAppVersion} or newer',
        'unavailable-platform': 'Not available on {platform}',
        'claim-clash':
          'The contribution “{name}” ({kind}) is already provided by extension “{by}”',
        'load-failed': 'Could not load the extension: {reason}',
        'overridden-by': 'Overridden by: {origin}, version {version}',
        'safe-mode': 'Disabled in safe mode',
        'dependency-missing':
          'Requires the extension “{id}”{range}, which is not installed',
        'dependency-disabled':
          'Requires the extension “{id}”{range}, which is disabled',
        'dependency-version':
          'Requires the extension “{id}”{range}, found version {found}',
        'dependency-unmet':
          'Requires the extension “{id}”{range}, which is not loaded: its dependencies are not met',
        'dependency-cycle': 'Extensions depend on each other: {cycle}',
        locale: {
          'missing-key':
            'No translation for "{key}" in locales/en.json: the label is shown as is',
          'invalid-file': 'Translation file {file} is ignored: {reason}',
        },
      },
      safeMode: {
        label: 'Safe mode',
        hint: 'Extensions other than the built-in ones are turned off and do not run. Installing and removing still work.',
        forced:
          'The mode comes from how the app was launched (a flag or an environment variable) and this switch does not turn it off.',
      },
      host: {
        gaveUpTitle: 'The extension host stopped after repeated failures',
        gaveUpText:
          'Extensions do not work until the host is started. The rest of the app works as usual.',
        restart: 'Restart host',
      },
      support: {
        title: 'Diagnostics',
        hint: 'The app and extension log, and a report for a support request. The report has no home-directory paths, library content, learning data or setting values.',
        openLog: 'Log',
        copy: 'Copy diagnostics',
        copying: 'Copying…',
        copied: 'Copied',
        copyFailed: 'Could not copy diagnostics',
      },
      log: {
        title: 'Log',
        rowAction: 'Log',
        rowActionLabel: 'Log of the extension “{name}”',
        filterExtension: 'Extension',
        filterExtensionHint: 'All extensions',
        filterLevel: 'Minimum level',
        level: {
          debug: 'Debug',
          info: 'Info',
          warn: 'Warning',
          error: 'Error',
        },
        sourceLabel: 'Source',
        extensionLabel: 'Extension',
        details: 'Details',
        listLabel: 'Log entries',
        refresh: 'Refresh',
        close: 'Close',
        empty: 'No entries match the filters.',
        loadFailed: 'Could not read the log',
        retry: 'Retry',
        count: 'no entries | {n} entry | {n} entries',
      },
      health: {
        failures:
          'no failures | {n} failure since the app started | {n} failures since the app started',
        last: 'Last failure at {time}: {reason}',
        suppressed:
          'Paused until {time}: the extension process crashed too often.',
        reason: {
          'handler-failed': 'handler error',
          'handler-timeout': 'handler timed out',
          timeout: 'timed out',
          'invalid-result': 'invalid result',
          'activation-failed': 'activation failed',
        },
      },
      installed: {
        fromCatalog: 'From the catalog v{version}',
        fromOtherCatalogShort: 'From another catalog',
        fromOtherCatalog: 'From another catalog v{version}',
        otherCatalogHint:
          'Installed from a catalog that is not in use now: the extension works, but updates, revocation and deprecation notes come only from the active catalog.',
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
        color: {
          picker: 'Pick a color: {label}',
        },
        list: {
          item: 'Item {n}',
          moveUp: 'Move item {n} up',
          moveDown: 'Move item {n} down',
          remove: 'Remove item {n}',
          newItem: 'New item',
          add: 'Add',
          count: '{n} of {max}',
        },
        problems: {
          type: 'This value does not fit the setting.',
          integer: 'A whole number is required.',
          range: 'The number is out of range.',
          'max-length': 'The value is too long.',
          format: 'Enter a color like #rrggbb.',
          'max-items': 'The list has too many items.',
          option: 'This option is not in the list.',
          'unknown-setting': 'The extension no longer declares this setting.',
          'not-a-number': 'Enter a number.',
        },
      },
      deprecated: {
        badge: 'Deprecated',
        title: 'This extension is deprecated',
        reason: 'Reason: {reason}',
        versions: 'Applies to versions: {range}',
        alternatives: 'Alternatives',
        alternativeLabel: 'Open the page of the extension “{name}”',
        hint: 'This is a warning: the extension can still be installed and updated.',
      },
      details: {
        back: 'Back',
        backLabel: 'Back to the extension list',
        loading: 'Loading the extension page',
        loadFailed: 'Could not load the extension',
        notFoundTitle: 'Extension not found',
        notFound:
          'The extension “{id}” is neither installed nor in the catalog.',
        authorProfile: '{author} on GitHub',
        source: 'Source',
        sourceLabel: 'Source of the extension “{name}” (opens in the browser)',
        installedStatus: 'Installed v{version}',
        catalogUnavailable:
          'The catalog is unavailable: only the installed extension is shown.',
        catalogOffline: 'No connection to the catalog: showing saved data',
        versions: {
          title: 'Versions',
          listLabel: 'Extension versions',
          published: 'Published {date}',
          compatible: 'Compatible',
          incompatible: 'Incompatible: {detail}',
          installed: 'Installed',
          shown: 'Description shown',
          show: 'Show description',
          showLabel: 'Show the description of version {version}',
          changelog: 'has a changelog',
        },
        readme: {
          title: 'README',
          version: 'Description of version {version}',
          loading: 'Loading the README',
          none: 'This version has no README.',
          unavailable: 'README unavailable',
          reason: 'Reason: {reason}',
          offline: 'No connection to the catalog: showing saved data',
          truncated: 'The text is truncated: showing the first 64 KiB.',
        },
        changelog: {
          title: 'What’s new',
        },
      },
      catalog: {
        listLabel: 'Catalog extensions',
        searchLabel: 'Search the catalog',
        searchHint: 'Name, id, description or author',
        kindsLabel: 'Filter by contribution kind',
        groupsLabel: 'Quick filters',
        tagsLabel: 'Filter by tag',
        kindsCaption: 'Contribution kinds',
        moreFilters: 'More filters',
        chipCount: '{label}: {n}',
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
        advanced: {
          title: 'Advanced',
          addressLabel: 'Catalog address',
          addressHint:
            'Address of a .json file: https, or http on this computer (localhost)',
          apply: 'Apply',
          reset: 'Reset',
          current: 'Active address',
          origin: {
            default: 'default',
            setting: 'from settings',
            env: 'from an environment variable',
          },
          envNote:
            'The address is set by the DOLPHY_EXTENSION_CATALOG_URL environment variable: the setting has no effect while it is set.',
          formerNote:
            'Extensions installed from the former catalog stay in the list and keep working, but get no updates from the new catalog.',
          applied: 'Catalog address changed',
          failed: 'Could not change the address: {message}',
          errors: {
            'not-url': 'This is not an address: check what you typed.',
            scheme:
              'An https address is required (http only for localhost and 127.0.0.1).',
            credentials:
              'The address must not contain a user name or password.',
            fragment:
              'The address must not contain a fragment (the part after #).',
            'not-json': 'The address must point to a .json file.',
            'too-long': 'The address is longer than 2048 characters.',
            env: 'The address is set by an environment variable and cannot be changed.',
          },
        },
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
        whatsNew: {
          title: 'What’s new',
          loading: 'Loading the changelog',
          notFound: 'No changelog found',
          failed: 'Could not load the changelog',
          openPage: 'Open the extension page',
          openPageLabel: 'Open the page of the extension “{name}”',
        },
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
      link: {
        busy: 'Wait for the installation to finish',
        notFound: 'Extension “{id}” was not found in the catalog',
        upToDate: 'Extension “{name}” is already installed: v{version}',
        elsewhere:
          'Extension “{name}” is already installed from another source. Remove the installed one first to install it from the catalog.',
        incompatible: 'Extension “{name}” is incompatible: {detail}',
        failed: 'Could not open the extension from the link: {message}',
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
