import type { ru } from './ru.ts';

export const en: typeof ru = {
  extensionCommands: {
    notice: {
      close: 'Close',
      changed: 'The extension has changed, try again.',
      timeout: 'The command timed out. Try again.',
      hostDown: 'Extensions are unavailable right now. Try again.',
      invalidResult: 'The extension returned an invalid response.',
      failed: 'The command failed.',
      failedWith: 'The command failed: {message}',
    },
  },
};
