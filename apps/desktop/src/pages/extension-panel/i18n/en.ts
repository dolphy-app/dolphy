import type { ru } from './ru.ts';

export const en: typeof ru = {
  extensionPanel: {
    back: 'Back',
    frameTitle: 'Panel “{title}” of extension {extension}, isolated frame',
    loadFailed: 'The panel failed to load',
    unavailable: {
      title: 'Panel unavailable',
      text: 'The extension is disabled or removed. The panel returns when the extension is enabled again.',
      toPlan: 'Go to today’s plan',
    },
  },
};
