import { describe, expect, it } from 'vitest';
import {
  chordToText,
  detectPlatform,
  formatChord,
  isTypingChord,
  KeybindingSyntaxError,
  parseChord,
  platformFromNode,
  spokenChord,
  tryParseChord,
} from '../src/index.ts';
import type { Platform } from '../src/index.ts';

const reasonOf = (text: string, platform: Platform = 'linux') => {
  try {
    parseChord(text, platform);
  } catch (error) {
    if (error instanceof KeybindingSyntaxError) return error.reason;
    throw error;
  }
  return null;
};

describe('parseChord', () => {
  it.each([
    ['Mod+K', 'linux', { ctrl: true, key: 'k' }],
    ['Mod+K', 'mac', { meta: true, key: 'k' }],
    ['mod+shift+L', 'windows', { ctrl: true, shift: true, key: 'l' }],
    ['Cmd+Option+Enter', 'mac', { meta: true, alt: true, key: 'enter' }],
    ['Win+E', 'windows', { meta: true, key: 'e' }],
    ['Ctrl+Alt+Delete', 'linux', { ctrl: true, alt: true, key: 'delete' }],
    ['Alt+Up', 'linux', { alt: true, key: 'arrowup' }],
    ['Mod+,', 'linux', { ctrl: true, key: ',' }],
    ['Mod++', 'linux', { ctrl: true, key: '+' }],
    ['Mod+Plus', 'linux', { ctrl: true, key: '+' }],
    ['F12', 'linux', { key: 'f12' }],
    ['Shift+F24', 'linux', { shift: true, key: 'f24' }],
    ['Mod+б', 'linux', { ctrl: true, key: 'б' }],
  ] as const)('reads %s on %s', (text, platform, expected) => {
    const [first] = parseChord(text, platform);
    expect(first).toEqual({
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
      code: '',
      ...expected,
    });
  });

  it('reads physical keys and two-step chords', () => {
    const [first, second] = parseChord('Mod+K [KeyS]', 'linux');
    expect(first?.key).toBe('k');
    expect(second).toMatchObject({ key: '', code: 'KeyS', ctrl: false });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['Mod+', 'modifier-only'],
    ['Mod', 'modifier-only'],
    ['Shift+Alt', 'modifier-only'],
    ['Mod+Mod+K', 'repeated-modifier'],
    ['Mod+Ctrl+K', 'repeated-modifier'],
    ['Hyper+K', 'unknown-modifier'],
    ['Mod++K', 'empty-part'],
    ['Mod+Foo', 'unknown-key'],
    ['K+Mod', 'unknown-modifier'],
    ['Mod+[Key', 'invalid-code'],
    ['Mod+K Mod+S Mod+D', 'too-long'],
    ['Mod+F25', 'unknown-key'],
  ])('rejects "%s" with %s', (text, reason) => {
    expect(reasonOf(text)).toBe(reason);
  });

  it('treats Mod+Ctrl as a repeat only where Mod is Ctrl', () => {
    expect(reasonOf('Mod+Ctrl+K', 'windows')).toBe('repeated-modifier');
    expect(reasonOf('Mod+Ctrl+K', 'mac')).toBeNull();
    expect(reasonOf('Mod+Cmd+K', 'mac')).toBe('repeated-modifier');
    expect(reasonOf('Mod+Cmd+K', 'linux')).toBeNull();
  });

  it('tryParseChord returns null instead of throwing', () => {
    expect(tryParseChord('Mod+Foo', 'linux')).toBeNull();
    expect(tryParseChord('Mod+K', 'linux')).not.toBeNull();
  });
});

describe('chordToText', () => {
  it.each([
    ['Cmd+Shift+L', 'mac', 'Mod+Shift+L'],
    ['Ctrl+Shift+L', 'linux', 'Mod+Shift+L'],
    ['Ctrl+Shift+L', 'mac', 'Ctrl+Shift+L'],
    ['Cmd+Shift+L', 'windows', 'Shift+Meta+L'],
    ['Meta+Ctrl+alt+arrowup', 'mac', 'Mod+Ctrl+Alt+ArrowUp'],
    ['mod+k mod+s', 'linux', 'Mod+K Mod+S'],
    ['mod+esc', 'linux', 'Mod+Escape'],
    ['Mod+[KeyK]', 'linux', 'Mod+[KeyK]'],
  ] as const)('writes %s on %s as %s', (text, platform, expected) => {
    expect(chordToText(parseChord(text, platform), platform)).toBe(expected);
  });

  it('round-trips: the canonical text parses back to the same chord', () => {
    for (const platform of ['mac', 'windows', 'linux'] as const) {
      for (const text of ['Mod+Shift+,', 'Ctrl+Alt+PageDown', 'Alt+F5']) {
        const chord = parseChord(text, platform);
        const again = parseChord(chordToText(chord, platform), platform);
        expect(again).toEqual(chord);
      }
    }
  });
});

describe('formatChord', () => {
  it.each([
    ['Mod+Shift+L', 'mac', '⇧⌘L'],
    ['Mod+Shift+L', 'windows', 'Ctrl+Shift+L'],
    ['Mod+K', 'mac', '⌘K'],
    ['Mod+K', 'linux', 'Ctrl+K'],
    ['Ctrl+Alt+Shift+Cmd+K', 'mac', '⌃⌥⇧⌘K'],
    ['Meta+E', 'windows', 'Win+E'],
    ['Meta+E', 'linux', 'Super+E'],
    ['Alt+ArrowLeft', 'linux', 'Alt+←'],
    ['Escape', 'mac', 'Esc'],
    ['Mod+K Mod+S', 'linux', 'Ctrl+K Ctrl+S'],
    ['Mod+[KeyK]', 'linux', 'Ctrl+K'],
  ] as const)('shows %s on %s as %s', (text, platform, expected) => {
    expect(formatChord(parseChord(text, platform), platform)).toBe(expected);
  });
});

describe('spokenChord', () => {
  const word = (id: string) => `<${id}>`;
  const speak = (text: string, platform: Platform) =>
    spokenChord(parseChord(text, platform), platform, word);

  it('names keys in words, by platform', () => {
    expect(speak('Mod+K', 'mac')).toBe('<command> K');
    expect(speak('Mod+K', 'linux')).toBe('<control> K');
    expect(speak('Mod+Shift+Alt+L', 'mac')).toBe(
      '<command> <option> <shift> L',
    );
    expect(speak('Mod+Alt+Enter', 'windows')).toBe('<control> <alt> <enter>');
    expect(speak('Meta+E', 'windows')).toBe('<windows> E');
    expect(speak('Meta+E', 'linux')).toBe('<super> E');
    expect(speak('Mod+,', 'linux')).toBe('<control> <comma>');
    expect(speak('Mod+1', 'mac')).toBe('<command> 1');
    expect(speak('Mod+K Mod+S', 'linux')).toBe('<control> K, <control> S');
  });
});

describe('isTypingChord', () => {
  it.each([
    ['K', true],
    ['Shift+K', true],
    ['Alt+K', true],
    [',', true],
    ['Enter', true],
    ['ArrowLeft', true],
    ['[KeyK]', true],
    ['Mod+K', false],
    ['Ctrl+Alt+K', false],
    ['Meta+K', false],
    ['F5', false],
    ['Shift+F5', false],
    ['Escape', false],
  ])('%s → %s', (text, expected) => {
    expect(isTypingChord(parseChord(text, 'linux'))).toBe(expected);
  });
});

describe('platform detection', () => {
  it('reads navigator and process names', () => {
    expect(detectPlatform({ platform: 'MacIntel' })).toBe('mac');
    expect(detectPlatform({ platform: 'iPad' })).toBe('mac');
    expect(detectPlatform({ platform: 'Win32' })).toBe('windows');
    expect(detectPlatform({ platform: 'Linux x86_64' })).toBe('linux');
    expect(
      detectPlatform({ platform: '', userAgent: 'Mozilla (Macintosh)' }),
    ).toBe('mac');
    expect(platformFromNode('darwin')).toBe('mac');
    expect(platformFromNode('win32')).toBe('windows');
    expect(platformFromNode('freebsd')).toBe('linux');
  });
});
