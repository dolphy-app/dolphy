/** Сочетание клавиш: `Mod` — Ctrl или ⌘, `key` — символ или имя клавиши в нижнем регистре. */
export interface Keybinding {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

export type Platform = 'apple' | 'other';

/** Сочетание, которое открывает палитру на любой странице. */
export const PALETTE_KEYBINDING = 'Mod+K';

const NAMED_KEYS: Record<string, string> = {
  enter: 'Enter',
  escape: 'Esc',
  tab: 'Tab',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
};

/**
 * `Mod+Shift+L` → сочетание. Модификаторы — `Mod`, `Shift`, `Alt` (любой
 * регистр, в любом порядке), последняя часть — клавиша: один символ или имя
 * из `Enter`, `Escape`, `Tab`, `Space`, `Backspace`, `Delete`, `Arrow*`.
 * Неверная запись — ошибка: опечатка в коде не должна молча остаться без
 * сочетания.
 */
export const parseKeybinding = (text: string): Keybinding => {
  const parts = text.split('+');
  const key = (parts.pop() ?? '').toLowerCase();
  const binding: Keybinding = { mod: false, shift: false, alt: false, key };
  for (const part of parts) {
    const name = part.toLowerCase();
    if (name !== 'mod' && name !== 'shift' && name !== 'alt') {
      throw new Error(
        `invalid keybinding "${text}": unknown modifier "${part}"`,
      );
    }
    if (binding[name]) {
      throw new Error(`invalid keybinding "${text}": repeated "${part}"`);
    }
    binding[name] = true;
  }
  if (key === '' || (key.length > 1 && !Object.hasOwn(NAMED_KEYS, key))) {
    throw new Error(`invalid keybinding "${text}": unknown key`);
  }
  return binding;
};

/** `null` вместо ошибки: для подсказок расширений, где запись — произвольный текст. */
export const tryParseKeybinding = (text: string): Keybinding | null => {
  try {
    return parseKeybinding(text);
  } catch {
    return null;
  }
};

const keyLabel = (key: string): string =>
  Object.hasOwn(NAMED_KEYS, key) ? NAMED_KEYS[key]! : key.toUpperCase();

/** Подпись для интерфейса: `⌘⇧L` на macOS, `Ctrl+Shift+L` на остальных. */
export const formatKeybinding = (
  binding: Keybinding,
  platform: Platform,
): string => {
  const key = keyLabel(binding.key);
  if (platform === 'apple') {
    return `${binding.alt ? '⌥' : ''}${binding.shift ? '⇧' : ''}${
      binding.mod ? '⌘' : ''
    }${key}`;
  }
  return [
    binding.mod ? 'Ctrl' : null,
    binding.alt ? 'Alt' : null,
    binding.shift ? 'Shift' : null,
    key,
  ]
    .filter((part) => part !== null)
    .join('+');
};

/** Подпись из записи: понятное сочетание форматируется по платформе, подсказка расширения — как есть. */
export const displayKeybinding = (text: string, platform: Platform): string => {
  const binding = tryParseKeybinding(text);
  return binding ? formatKeybinding(binding, platform) : text;
};

/** Платформа окна: подпись клавиши Mod зависит только от неё. */
export const detectPlatform = (
  nav: Pick<Navigator, 'platform'> = navigator,
): Platform =>
  /^(Mac|iPhone|iPad|iPod)/i.test(nav.platform) ? 'apple' : 'other';

type KeyEventLike = Pick<
  KeyboardEvent,
  'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'code' | 'key'
>;

/**
 * Событие совпадает с сочетанием: `Mod` — Ctrl или ⌘ (любой из двух), остальные
 * модификаторы строго как заданы. Буквы сравниваются по физической клавише
 * (`KeyK`) или по символу, поэтому сочетание работает и в русской раскладке.
 */
export const matchesKeybinding = (
  event: KeyEventLike,
  binding: Keybinding,
): boolean => {
  if ((event.ctrlKey || event.metaKey) !== binding.mod) return false;
  if (event.shiftKey !== binding.shift || event.altKey !== binding.alt) {
    return false;
  }
  if (event.key.toLowerCase() === binding.key) return true;
  return (
    /^[a-z]$/.test(binding.key) &&
    event.code === `Key${binding.key.toUpperCase()}`
  );
};
