import type { ru } from './ru.ts';

export const en: typeof ru = {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    retry: 'Try again',
    extensionUpdates: 'Updates available: {n}',
  },
  keybinding: {
    command: 'Command',
    control: 'Control',
    windows: 'Windows',
    super: 'Super',
    shift: 'Shift',
    option: 'Option',
    alt: 'Alt',
    comma: 'comma',
    plus: 'plus',
    enter: 'Enter',
    escape: 'Escape',
    tab: 'Tab',
    space: 'Space',
    backspace: 'Backspace',
    delete: 'Delete',
    insert: 'Insert',
    home: 'Home',
    end: 'End',
    pageup: 'Page Up',
    pagedown: 'Page Down',
    arrowup: 'up arrow',
    arrowdown: 'down arrow',
    arrowleft: 'left arrow',
    arrowright: 'right arrow',
  },
  markdown: {
    frameTitle: '“{language}” block from an extension, isolated frame',
    renderFailed:
      'Could not render the “{language}” block; showing the source.',
  },
  reason: {
    new: 'New',
    review: 'Review',
    remediation: 'Foundations refresh',
  },
  reasonHint: {
    new: 'An exercise you have not done yet.',
    review: 'Material you have already studied: reviewing keeps it in memory.',
    remediation:
      'An exercise on foundations you got wrong: they are needed to move on.',
  },
};
