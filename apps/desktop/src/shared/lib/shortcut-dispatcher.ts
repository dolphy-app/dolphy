import type { CommandRegistry } from './command-registry.ts';
import {
  matchesKeybinding,
  PALETTE_KEYBINDING,
  parseKeybinding,
} from './keybinding.ts';
import type { Keybinding } from './keybinding.ts';

export interface ShortcutDispatcherDeps {
  registry: CommandRegistry;
  /** Ctrl/⌘+K: открывает палитру. */
  openPalette(): void;
}

const EDITABLE =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
// открытый диалог или меню: фокус и ввод принадлежат им
const MODAL =
  '.v-dialog.v-overlay--active, .v-menu.v-overlay--active, [role="dialog"][aria-modal="true"], dialog[open]';

const PALETTE = parseKeybinding(PALETTE_KEYBINDING);

/** Фокус в поле ввода или редактируемом элементе: печатающий пользователь клавиши командам не отдаёт. */
const isTyping = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(EDITABLE) !== null;

const hasOpenModal = (doc: Document): boolean =>
  doc.querySelector(MODAL) !== null;

/**
 * Единственный обработчик клавиш окна (на `document`, в фазе перехвата).
 * Ctrl/⌘+K открывает палитру везде. Сочетания команд приложения выполняются,
 * если фокус не в поле ввода, нет открытого диалога или меню и клавиша не
 * повторяется; `preventDefault` — только когда сочетание обработано. События
 * из рамок расширений сюда не приходят: рамка пересылает родителю лишь
 * Ctrl/⌘+K (`shortcut` в `frame-bridge`), поэтому у расширений нет пути
 * запустить чужую команду клавишей. Возвращает снятие обработчика.
 */
export const installShortcutDispatcher = (
  doc: Document,
  deps: ShortcutDispatcherDeps,
): (() => void) => {
  const handler = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.repeat) return;

    if (matchesKeybinding(event, PALETTE)) {
      event.preventDefault();
      deps.openPalette();
      return;
    }

    if (isTyping(event.target) || hasOpenModal(doc)) return;
    for (const command of deps.registry.list.value) {
      if (
        command.source !== 'app' ||
        command.keybinding === undefined ||
        !command.enabled
      ) {
        continue;
      }
      const binding: Keybinding = parseKeybinding(command.keybinding);
      if (!matchesKeybinding(event, binding)) continue;
      event.preventDefault();
      void command.run();
      return;
    }
  };
  doc.addEventListener('keydown', handler, true);
  return () => doc.removeEventListener('keydown', handler, true);
};
