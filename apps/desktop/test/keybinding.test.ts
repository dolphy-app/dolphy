import { describe, expect, it } from 'vitest';
import {
  detectPlatform,
  formatKeybinding,
  matchesKeybinding,
  parseKeybinding,
  tryParseKeybinding,
} from '@/shared/lib/keybinding.ts';

const event = (init: Partial<KeyboardEvent> & { key: string }) => ({
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  code: '',
  ...init,
});

describe('parseKeybinding', () => {
  it('reads modifiers in any order and case', () => {
    expect(parseKeybinding('Mod+Shift+L')).toEqual({
      mod: true,
      shift: true,
      alt: false,
      key: 'l',
    });
    expect(parseKeybinding('shift+ALT+mod+,')).toEqual({
      mod: true,
      shift: true,
      alt: true,
      key: ',',
    });
    expect(parseKeybinding('Alt+ArrowUp').key).toBe('arrowup');
  });

  it.each(['', 'Mod+', 'Ctrl+K', 'Mod+Mod+K', 'Mod+Foo', 'K+Mod'])(
    'rejects %j',
    (text) => {
      expect(() => parseKeybinding(text)).toThrow(/invalid keybinding/);
    },
  );

  it('tryParseKeybinding returns null for free-form hints', () => {
    expect(tryParseKeybinding('Ctrl-Shift-S')).toBeNull();
    expect(tryParseKeybinding('Mod+S')).not.toBeNull();
  });
});

describe('formatKeybinding', () => {
  it('uses symbols on Apple platforms and words elsewhere', () => {
    const binding = parseKeybinding('Mod+Shift+L');
    expect(formatKeybinding(binding, 'apple')).toBe('⇧⌘L');
    expect(formatKeybinding(binding, 'other')).toBe('Ctrl+Shift+L');
    expect(formatKeybinding(parseKeybinding('Mod+K'), 'apple')).toBe('⌘K');
    expect(formatKeybinding(parseKeybinding('Mod+K'), 'other')).toBe('Ctrl+K');
    expect(formatKeybinding(parseKeybinding('Alt+Enter'), 'other')).toBe(
      'Alt+Enter',
    );
  });

  it('detects the platform from navigator.platform', () => {
    expect(detectPlatform({ platform: 'MacIntel' })).toBe('apple');
    expect(detectPlatform({ platform: 'Win32' })).toBe('other');
    expect(detectPlatform({ platform: 'Linux x86_64' })).toBe('other');
  });
});

describe('matchesKeybinding', () => {
  const modK = parseKeybinding('Mod+K');

  it('accepts Ctrl or ⌘ for Mod, by symbol or by physical key', () => {
    expect(matchesKeybinding(event({ key: 'k', ctrlKey: true }), modK)).toBe(
      true,
    );
    expect(matchesKeybinding(event({ key: 'K', metaKey: true }), modK)).toBe(
      true,
    );
    // русская раскладка: символ «л», физическая клавиша KeyK
    expect(
      matchesKeybinding(event({ key: 'л', code: 'KeyK', ctrlKey: true }), modK),
    ).toBe(true);
  });

  it('requires exactly the declared modifiers', () => {
    expect(matchesKeybinding(event({ key: 'k' }), modK)).toBe(false);
    expect(
      matchesKeybinding(
        event({ key: 'k', ctrlKey: true, shiftKey: true }),
        modK,
      ),
    ).toBe(false);
    expect(
      matchesKeybinding(event({ key: 'k', ctrlKey: true, altKey: true }), modK),
    ).toBe(false);
    expect(
      matchesKeybinding(
        event({ key: 'l', ctrlKey: true, shiftKey: true }),
        parseKeybinding('Mod+Shift+L'),
      ),
    ).toBe(true);
  });

  it('matches punctuation by symbol', () => {
    expect(
      matchesKeybinding(
        event({ key: ',', ctrlKey: true }),
        parseKeybinding('Mod+,'),
      ),
    ).toBe(true);
  });
});
