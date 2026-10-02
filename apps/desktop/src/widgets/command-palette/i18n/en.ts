import type { ru } from './ru.ts';

export const en: typeof ru = {
  commandPalette: {
    title: 'Command palette',
    label: 'Find a command',
    placeholder: 'Title, category or extension',
    list: 'Commands',
    count: 'No commands | {n} command found | {n} commands found',
    empty: 'No commands',
    emptyHint: 'Commands appear when an extension with commands is enabled.',
    noMatches: 'No matching commands',
    noMatchesHint: 'Change the query.',
    busy: 'Running',
  },
};
