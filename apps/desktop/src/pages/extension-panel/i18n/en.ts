import type { ru } from './ru.ts';

export const en: typeof ru = {
  extensionPanel: {
    back: 'Back',
    loadFailed: 'The panel failed to load',
    loading: 'The panel is loading',
    retry: 'Retry',
    unavailable: {
      title: 'Panel unavailable',
      text: 'The extension is disabled or removed. The panel returns when the extension is enabled again.',
      toPlan: 'Go to today’s plan',
    },
  },
};
