import type { ru } from './ru.ts';

export const en: typeof ru = {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    retry: 'Try again',
    hint: 'What is this?',
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
    renderFailed:
      'Could not render the “{language}” block; showing the source.',
  },
  reason: {
    new: 'New',
    review: 'Review',
    remediation: 'Foundations refresh',
  },
  reasonHint: {
    new: 'New: you have not done this exercise yet',
    review: 'Review: you have already done this exercise',
    remediation: 'Foundations refresh: added after mistakes',
  },
};
