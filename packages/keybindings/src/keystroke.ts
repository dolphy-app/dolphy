import type { Platform } from './platform.ts';

/**
 * Одно нажатие: модификаторы и клавиша. `key` — логическое имя в нижнем
 * регистре (`k`, `,`, `enter`, `arrowup`, `f5`), `code` — физическая клавиша
 * (`KeyK`) для записи `[KeyK]`; задано ровно одно из двух. `Mod` в нажатии
 * уже раскрыт в Ctrl или Meta.
 */
export interface Keystroke {
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
  readonly key: string;
  readonly code: string;
}

/** Сочетание: одно нажатие или цепочка из двух. */
export type Chord = readonly Keystroke[];

export const MAX_CHORD_LENGTH = 2;

export type SyntaxReason =
  | 'empty'
  | 'empty-part'
  | 'too-long'
  | 'modifier-only'
  | 'unknown-modifier'
  | 'repeated-modifier'
  | 'unknown-key'
  | 'invalid-code';

export class KeybindingSyntaxError extends Error {
  readonly reason: SyntaxReason;
  readonly text: string;

  constructor(reason: SyntaxReason, text: string) {
    super(`invalid keybinding "${text}": ${reason}`);
    this.name = 'KeybindingSyntaxError';
    this.reason = reason;
    this.text = text;
  }
}

type ModifierName = 'mod' | 'ctrl' | 'alt' | 'shift' | 'meta';

const MODIFIER_ALIASES: Record<string, ModifierName> = {
  mod: 'mod',
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  win: 'meta',
  super: 'meta',
};

const NAMED_KEYS: Record<string, string> = {
  enter: 'enter',
  return: 'enter',
  escape: 'escape',
  esc: 'escape',
  tab: 'tab',
  space: 'space',
  spacebar: 'space',
  backspace: 'backspace',
  delete: 'delete',
  del: 'delete',
  insert: 'insert',
  ins: 'insert',
  home: 'home',
  end: 'end',
  pageup: 'pageup',
  pgup: 'pageup',
  pagedown: 'pagedown',
  pgdn: 'pagedown',
  arrowup: 'arrowup',
  up: 'arrowup',
  arrowdown: 'arrowdown',
  down: 'arrowdown',
  arrowleft: 'arrowleft',
  left: 'arrowleft',
  arrowright: 'arrowright',
  right: 'arrowright',
  plus: '+',
};

const CANONICAL_TEXT: Record<string, string> = {
  enter: 'Enter',
  escape: 'Escape',
  tab: 'Tab',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
};

const LABELS: Record<string, string> = {
  enter: 'Enter',
  escape: 'Esc',
  tab: 'Tab',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'Page Up',
  pagedown: 'Page Down',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
};

const CODE_KEYS: Record<string, string> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

const MODIFIER_ONLY_KEYS = new Set([
  'control',
  'shift',
  'alt',
  'altgraph',
  'meta',
  'os',
  'capslock',
  'numlock',
  'fn',
  'process',
  'unidentified',
]);

const META_LABEL: Record<Platform, string> = {
  mac: '⌘',
  windows: 'Win',
  linux: 'Super',
};

const META_WORD: Record<Platform, SpokenId> = {
  mac: 'command',
  windows: 'windows',
  linux: 'super',
};

const FUNCTION_KEY = /^f([1-9]|1\d|2[0-4])$/;
const PHYSICAL = /^\[([A-Za-z][A-Za-z0-9]*)\]$/;

const own = (table: Record<string, string>, key: string): string | undefined =>
  Object.hasOwn(table, key) ? table[key] : undefined;

/** Логическая клавиша, которую даёт физическая: `KeyK` → `k`, `Comma` → `,`; нет соответствия — `undefined`. */
export const codeToKey = (code: string): string | undefined => {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!.toLowerCase();
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1]!;
  return own(CODE_KEYS, code);
};

const isSingleCharacter = (text: string): boolean =>
  Array.from(text).length === 1 && !/\s/u.test(text);

/** Имя клавиши записи в каноническую логическую форму; `null` — неизвестное имя. */
const normalizeKeyName = (part: string): string | null => {
  const lower = part.toLowerCase();
  const named = own(NAMED_KEYS, lower);
  if (named !== undefined) return named;
  if (FUNCTION_KEY.test(lower)) return lower;
  return isSingleCharacter(part) ? lower : null;
};

type Flags = { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean };

const stroke = (flags: Flags, key: string, code: string): Keystroke => ({
  ctrl: flags.ctrl,
  alt: flags.alt,
  shift: flags.shift,
  meta: flags.meta,
  key,
  code,
});

/** `Mod++` — клавиша `+`; `Mod+K` — модификаторы и клавиша. */
const splitStroke = (text: string): { modifiers: string[]; key: string } => {
  if (text === '+') return { modifiers: [], key: '+' };
  const plus = text.endsWith('++');
  const index = plus ? text.length - 2 : text.lastIndexOf('+');
  if (index < 0) return { modifiers: [], key: text };
  const head = text.slice(0, index);
  return {
    modifiers: head.split('+'),
    key: plus ? '+' : text.slice(index + 1),
  };
};

const parseStroke = (
  text: string,
  platform: Platform,
  whole: string,
): Keystroke => {
  const { modifiers, key: keyPart } = splitStroke(text);
  const flags: Flags = { ctrl: false, alt: false, shift: false, meta: false };
  for (const token of modifiers) {
    if (token === '') throw new KeybindingSyntaxError('empty-part', whole);
    const name = own(MODIFIER_ALIASES, token.toLowerCase());
    if (name === undefined) {
      throw new KeybindingSyntaxError('unknown-modifier', whole);
    }
    const primary = platform === 'mac' ? 'meta' : 'ctrl';
    const resolved = name === 'mod' ? primary : name;
    if (flags[resolved as keyof Flags]) {
      throw new KeybindingSyntaxError('repeated-modifier', whole);
    }
    flags[resolved as keyof Flags] = true;
  }
  if (
    keyPart === '' ||
    Object.hasOwn(MODIFIER_ALIASES, keyPart.toLowerCase())
  ) {
    throw new KeybindingSyntaxError('modifier-only', whole);
  }
  const physical = PHYSICAL.exec(keyPart);
  if (physical) return stroke(flags, '', physical[1]!);
  if (
    keyPart.length > 1 &&
    (keyPart.startsWith('[') || keyPart.endsWith(']'))
  ) {
    throw new KeybindingSyntaxError('invalid-code', whole);
  }
  const key = normalizeKeyName(keyPart);
  if (key === null) throw new KeybindingSyntaxError('unknown-key', whole);
  return stroke(flags, key, '');
};

/**
 * `Mod+Shift+L` или `Mod+K Mod+S` → сочетание для платформы. `Mod` — Meta на
 * macOS и Ctrl на остальных; остальные модификаторы — по имени. Ошибка
 * записи — `KeybindingSyntaxError` с причиной.
 */
export const parseChord = (text: string, platform: Platform): Chord => {
  const trimmed = text.trim();
  if (trimmed === '') throw new KeybindingSyntaxError('empty', text);
  const parts = trimmed.split(/\s+/);
  if (parts.length > MAX_CHORD_LENGTH) {
    throw new KeybindingSyntaxError('too-long', text);
  }
  return parts.map((part) => parseStroke(part, platform, text));
};

/** `null` вместо ошибки. */
export const tryParseChord = (
  text: string,
  platform: Platform,
): Chord | null => {
  try {
    return parseChord(text, platform);
  } catch (error) {
    if (error instanceof KeybindingSyntaxError) return null;
    throw error;
  }
};

const keyText = (item: Keystroke): string => {
  if (item.code !== '') return `[${item.code}]`;
  return own(CANONICAL_TEXT, item.key) ?? item.key.toUpperCase();
};

const strokeToText = (item: Keystroke, platform: Platform): string => {
  const primary = platform === 'mac' ? 'meta' : 'ctrl';
  const parts: string[] = [];
  if (item[primary]) parts.push('Mod');
  if (primary !== 'ctrl' && item.ctrl) parts.push('Ctrl');
  if (item.alt) parts.push('Alt');
  if (item.shift) parts.push('Shift');
  if (primary !== 'meta' && item.meta) parts.push('Meta');
  parts.push(keyText(item));
  return parts.join('+');
};

/** Каноническая запись для хранения: `Mod` вместо основного модификатора платформы. */
export const chordToText = (chord: Chord, platform: Platform): string =>
  chord.map((item) => strokeToText(item, platform)).join(' ');

const labelOfKey = (item: Keystroke): string => {
  if (item.code === '') return own(LABELS, item.key) ?? item.key.toUpperCase();
  return (
    /^Key([A-Z])$/.exec(item.code)?.[1] ??
    /^Digit(\d)$/.exec(item.code)?.[1] ??
    item.code
  );
};

const strokeLabel = (item: Keystroke, platform: Platform): string => {
  const key = labelOfKey(item);
  if (platform === 'mac') {
    return `${item.ctrl ? '⌃' : ''}${item.alt ? '⌥' : ''}${
      item.shift ? '⇧' : ''
    }${item.meta ? '⌘' : ''}${key}`;
  }
  return [
    item.ctrl ? 'Ctrl' : null,
    item.alt ? 'Alt' : null,
    item.shift ? 'Shift' : null,
    item.meta ? META_LABEL[platform] : null,
    key,
  ]
    .filter((part) => part !== null)
    .join('+');
};

/** Подпись для интерфейса: `⇧⌘L` на macOS, `Ctrl+Shift+L` на остальных; цепочка — через пробел. */
export const formatChord = (chord: Chord, platform: Platform): string =>
  chord.map((item) => strokeLabel(item, platform)).join(' ');

/** Идентификаторы слов, которыми озвучивается сочетание (тексты — `keybinding.*` в общих сообщениях). */
export type SpokenId =
  | 'command'
  | 'control'
  | 'windows'
  | 'super'
  | 'shift'
  | 'option'
  | 'alt'
  | 'comma'
  | 'plus'
  | 'enter'
  | 'escape'
  | 'tab'
  | 'space'
  | 'backspace'
  | 'delete'
  | 'insert'
  | 'home'
  | 'end'
  | 'pageup'
  | 'pagedown'
  | 'arrowup'
  | 'arrowdown'
  | 'arrowleft'
  | 'arrowright';

const SPOKEN_KEYS: Record<string, SpokenId> = {
  ',': 'comma',
  '+': 'plus',
  enter: 'enter',
  escape: 'escape',
  tab: 'tab',
  space: 'space',
  backspace: 'backspace',
  delete: 'delete',
  insert: 'insert',
  home: 'home',
  end: 'end',
  pageup: 'pageup',
  pagedown: 'pagedown',
  arrowup: 'arrowup',
  arrowdown: 'arrowdown',
  arrowleft: 'arrowleft',
  arrowright: 'arrowright',
};

const spokenStroke = (
  item: Keystroke,
  platform: Platform,
  word: (id: SpokenId) => string,
): string => {
  const mac = platform === 'mac';
  const control = item.ctrl ? word('control') : null;
  const meta = item.meta ? word(META_WORD[platform]) : null;
  const spoken = Object.hasOwn(SPOKEN_KEYS, item.key)
    ? SPOKEN_KEYS[item.key]
    : undefined;
  return [
    ...(mac ? [meta, control] : [control, meta]),
    item.alt ? word(mac ? 'option' : 'alt') : null,
    item.shift ? word('shift') : null,
    spoken === undefined ? labelOfKey(item) : word(spoken),
  ]
    .filter((part) => part !== null)
    .join(' ');
};

/**
 * Сочетание словами для скринридера: `⌘K` без этого читается как набор
 * символов. На macOS — «Command Option Shift L», иначе — «Control Alt Shift L»;
 * нажатия цепочки разделены запятой.
 */
export const spokenChord = (
  chord: Chord,
  platform: Platform,
  word: (id: SpokenId) => string,
): string => chord.map((item) => spokenStroke(item, platform, word)).join(', ');

/**
 * Ключ сравнения нажатия: модификаторы и клавиша. Физическая клавиша, у
 * которой есть логическое имя (`[KeyK]`), приравнена к нему (`k`): на любой
 * раскладке такие записи могут сработать от одного нажатия.
 */
export const strokeKey = (item: Keystroke): string => {
  const key =
    item.code === '' ? item.key : (codeToKey(item.code) ?? `[${item.code}]`);
  const flags = `${item.ctrl ? 'c' : ''}${item.alt ? 'a' : ''}${
    item.shift ? 's' : ''
  }${item.meta ? 'm' : ''}`;
  return `${flags}:${key}`;
};

/** Сочетание начинается нажатиями `prefix` (или совпадает с ним). */
export const chordStartsWith = (chord: Chord, prefix: Chord): boolean =>
  prefix.length <= chord.length &&
  prefix.every((item, index) => strokeKey(item) === strokeKey(chord[index]!));

/**
 * Первое нажатие печатает или правит текст (`K`, `Shift+K`, `,`, `Enter`,
 * стрелки): без Ctrl и Meta такое сочетание срабатывало бы при наборе. Не
 * считаются `Escape` и F1–F24.
 */
export const isTypingChord = (chord: Chord): boolean => {
  const first = chord[0];
  if (first === undefined || first.ctrl || first.meta) return false;
  if (first.code !== '') return true;
  return first.key !== 'escape' && !FUNCTION_KEY.test(first.key);
};

/** Событие клавиатуры в том виде, который нужен сопоставлению (подмножество `KeyboardEvent`). */
export interface KeyEventLike {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly isComposing?: boolean;
  getModifierState?(name: string): boolean;
}

const eventKeyName = (key: string): string => {
  if (key === ' ') return 'space';
  if (key.length > 1)
    return own(NAMED_KEYS, key.toLowerCase()) ?? key.toLowerCase();
  return key.toLowerCase();
};

const isAsciiLetter = (key: string): boolean => /^[A-Za-z]$/.test(key);

/** Модификаторы события; AltGr (Ctrl+Alt на Windows) не считается ни тем, ни другим. */
const eventFlags = (event: KeyEventLike): Flags & { altGraph: boolean } => {
  const altGraph = event.getModifierState?.('AltGraph') === true;
  return {
    ctrl: altGraph ? false : event.ctrlKey,
    alt: altGraph ? false : event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
    altGraph,
  };
};

/**
 * Событие совпадает с нажатием. Модификаторы — ровно заданные (AltGr не
 * считается Ctrl+Alt). Физическая запись сверяется по `code`. Логическая — по
 * `event.key`: буква ASCII окончательна (Dvorak, Colemak, AZERTY); если `key`
 * не ASCII-буква (русская раскладка, мёртвые клавиши, ⌥+буква на macOS),
 * клавишу определяет `code`. Событие во время IME-ввода не совпадает.
 */
export const matchKeystroke = (
  event: KeyEventLike,
  expected: Keystroke,
): boolean => {
  if (event.isComposing === true) return false;
  const flags = eventFlags(event);
  if (flags.altGraph && (expected.ctrl || expected.alt)) return false;
  if (flags.ctrl !== expected.ctrl || flags.alt !== expected.alt) return false;
  if (flags.meta !== expected.meta) return false;

  if (expected.code !== '') {
    return flags.shift === expected.shift && event.code === expected.code;
  }

  const name = eventKeyName(event.key);
  if (name === expected.key) {
    const isSymbol = isSingleCharacter(name) && !/^\p{Letter}$/u.test(name);
    return flags.shift === expected.shift || (isSymbol && !expected.shift);
  }
  if (isAsciiLetter(event.key)) return false;
  const isNativeLatin =
    /^\p{Script=Latin}$/u.test(event.key) && event.code.startsWith('Key');
  if (isNativeLatin && !event.altKey) return false;
  return (
    codeToKey(event.code) === expected.key && flags.shift === expected.shift
  );
};

/**
 * Событие в нажатие для записи сочетания в интерфейсе; `null` — одиночный
 * модификатор или клавиша без имени. Именованные клавиши и буква ASCII
 * записываются по `key`, остальное — по логическому имени физической клавиши
 * (`KeyK` на русской раскладке → `k`), без имени — физической записью.
 */
export const eventToKeystroke = (event: KeyEventLike): Keystroke | null => {
  const name = eventKeyName(event.key);
  if (MODIFIER_ONLY_KEYS.has(name)) return null;
  const { ctrl, alt, shift, meta } = eventFlags(event);
  const flags: Flags = { ctrl, alt, shift, meta };
  const isNamed =
    name === 'space' ||
    Object.hasOwn(CANONICAL_TEXT, name) ||
    FUNCTION_KEY.test(name);
  if (isNamed || isAsciiLetter(event.key)) return stroke(flags, name, '');
  const mapped = codeToKey(event.code);
  if (mapped !== undefined) return stroke(flags, mapped, '');
  if (isSingleCharacter(event.key)) return stroke(flags, name, '');
  return event.code === '' ? null : stroke(flags, '', event.code);
};
