import type { ru } from './ru.ts';

export const en: typeof ru = {
  transfers: {
    category: 'Import and export',
    command: {
      import: 'Import: {title}',
      export: 'Export: {title}',
    },
    working: {
      import: 'Choosing and reading the file: “{title}”…',
      commit: 'Writing the course to the library…',
      export: 'Exporting: “{title}”…',
      save: 'Saving the file: “{title}”…',
      hint: 'The extension has at most 30 seconds to respond.',
    },
    file: {
      tooLarge: 'The file “{name}” is too large: at most {size} MiB.',
      unsupported: 'The file “{name}” does not fit: expected one of {accept}.',
      notUtf8:
        'The file “{name}” is not UTF-8 text: the extension was not called.',
      pickFailed: 'Could not open the file.',
    },
    import: {
      title: 'Import: {title}',
      file: 'File: {name}',
      courses: 'Courses',
      lessons: 'Lessons',
      exercises: 'Exercises',
      files: 'Files in the course: {n}',
      replaces:
        'This import will replace the existing course in “{path}”. The previous copy will be removed.',
      target: 'The course will be written to “{path}”.',
      hasErrors:
        'The course has errors and cannot be imported. Nothing was left on disk.',
      noCourses: 'The file contains no courses. Nothing was left on disk.',
      diagnostics: 'Course problems',
      moreHidden:
        'Showing the first {n}; the rest are in the totals: {errors} errors, {warnings} warnings.',
      errors: 'Errors: {n}',
      warnings: 'Warnings: {n}',
      severity: { error: 'Error', warning: 'Warning' },
      submit: 'Import',
      cancel: 'Cancel',
      close: 'Close',
      done: 'Imported courses: {n} (“{path}”).',
    },
    export: {
      title: 'Export: {title}',
      choose: 'Choose a course to export',
      course: 'Course',
      noCourses: 'The library has no courses to export.',
      submit: 'Export',
      cancel: 'Cancel',
      saved: 'The file “{name}” was saved.',
      saveFailed: 'Could not save the file.',
    },
    failure: {
      changed: 'The set of extensions has changed. Try again.',
      timeout:
        'The extension did not respond within 30 seconds. Nothing was written.',
      hostDown: 'Extensions are unavailable right now. Try again.',
      invalidResult:
        'The extension returned an invalid result. Nothing was written.',
      failed: 'The action failed. Nothing was written.',
      failedWith: 'The action failed: {message}',
      tooLarge:
        'The data is larger than 20 MiB: the extension was not called. Nothing was written.',
      reloadRejected:
        'The library did not accept the course (for example, a duplicate course id). The previous library is intact and the import was rolled back.',
      importExpired: 'The import has expired. Choose the file again.',
      courseGone: 'The course is no longer in the library.',
    },
  },
};
