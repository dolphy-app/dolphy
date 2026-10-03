import type { ru } from './ru.ts';

export const en: typeof ru = {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    retry: 'Try again',
  },
  keybinding: {
    command: 'Command',
    control: 'Control',
    shift: 'Shift',
    option: 'Option',
    alt: 'Alt',
    comma: 'comma',
    enter: 'Enter',
    escape: 'Escape',
    tab: 'Tab',
    space: 'Space',
    backspace: 'Backspace',
    delete: 'Delete',
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
};
