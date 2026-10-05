import type { ru } from './ru.ts';

export const en: typeof ru = {
  repository: {
    phase: {
      resolve: 'Checking the repository',
      fetch: 'Downloading',
      export: 'Unpacking',
      validate: 'Validating courses',
      reload: 'Updating the library',
    },
    updateAvailable: 'Update available',
    status: {
      ready: 'Ready',
      updating: 'Updating',
      error: 'Error',
    },
    validation: {
      'url-empty': 'Enter the repository address',
      'url-invalid': 'This does not look like an address',
      'url-scheme': 'The address must start with http:// or https://',
      'url-credentials': 'Remove the username and password from the address',
      'ref-spaces': 'A branch or tag name cannot contain spaces',
      'ref-dotdot': 'A branch or tag name cannot contain “..”',
    },
    error: {
      fetch: {
        'not-found': 'Repository not found: check the address.',
        'auth-required':
          'The repository is private. Only public repositories are supported.',
        'ref-not-found': 'The repository has no such branch or tag.',
        timeout: 'The server is not responding. Try again later.',
        network: 'Cannot reach the server. Check your network connection.',
        'too-large': 'The repository is too large to download.',
        cancelled: 'The operation was cancelled.',
        unknown: 'Could not download the repository.',
      },
      exists: 'This repository has already been added.',
      invalid: 'The value was not accepted.',
      notFound: 'The repository is not in the list.',
      rejected: {
        symlink: 'The repository contains symbolic links.',
        'path-escapes': 'The repository has paths outside the course folder.',
        'git-segment': 'The repository contains .git directories.',
        'unsafe-name': 'The repository has file names not allowed on Windows.',
        'case-collision': 'The repository has paths that differ only in case.',
        'special-file': 'The repository contains files of a disallowed type.',
        'too-many-files': 'The repository has too many files.',
        'too-large': 'The repository is too large.',
        'file-too-large': 'The repository contains a file that is too large.',
        'no-courses': 'No courses were found in the repository.',
        'invalid-library': 'The courses in the repository contain errors.',
        'reload-rejected':
          'The library rejected the repository courses, for example because of a duplicate id.',
        'path-conflict': 'The repository folder in the library is taken.',
        unknown: 'The repository was rejected.',
      },
      unknown: 'Something went wrong.',
      path: 'Path: {path}',
    },
  },
};
