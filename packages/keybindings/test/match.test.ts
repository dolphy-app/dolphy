import { describe, expect, it } from 'vitest';
import {
  eventToKeystroke,
  matchKeystroke,
  parseChord,
  chordToText,
} from '../src/index.ts';
import type { KeyEventLike, Platform } from '../src/index.ts';

const press = (
  init: Partial<KeyEventLike> & { key: string },
): KeyEventLike => ({
  code: '',
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...init,
});

const matches = (
  text: string,
  event: KeyEventLike,
  platform: Platform = 'linux',
) => matchKeystroke(event, parseChord(text, platform)[0]!);

describe('matchKeystroke: modifiers', () => {
  it('requires exactly the declared modifiers', () => {
    expect(matches('Mod+K', press({ key: 'k', ctrlKey: true }))).toBe(true);
    expect(matches('Mod+K', press({ key: 'k' }))).toBe(false);
    expect(
      matches('Mod+K', press({ key: 'k', ctrlKey: true, shiftKey: true })),
    ).toBe(false);
    expect(
      matches('Mod+K', press({ key: 'k', ctrlKey: true, altKey: true })),
    ).toBe(false);
    expect(
      matches(
        'Mod+Shift+L',
        press({ key: 'L', ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(true);
  });

  it('resolves Mod strictly by platform', () => {
    const ctrlK = press({ key: 'k', ctrlKey: true });
    const cmdK = press({ key: 'k', metaKey: true });
    expect(matches('Mod+K', cmdK, 'mac')).toBe(true);
    expect(matches('Mod+K', ctrlK, 'mac')).toBe(false);
    expect(matches('Mod+K', ctrlK, 'windows')).toBe(true);
    expect(matches('Mod+K', cmdK, 'windows')).toBe(false);
    expect(matches('Ctrl+K', ctrlK, 'mac')).toBe(true);
  });

  it('does not count AltGr as Ctrl+Alt', () => {
    const altGr = press({
      key: 'q',
      ctrlKey: true,
      altKey: true,
      getModifierState: (name) => name === 'AltGraph',
    });
    expect(matches('Ctrl+Alt+Q', altGr)).toBe(false);
    expect(matches('Ctrl+Q', altGr)).toBe(false);
    expect(matches('Q', altGr)).toBe(true);
  });

  it('ignores events during IME composition', () => {
    expect(
      matches('Mod+K', press({ key: 'k', ctrlKey: true, isComposing: true })),
    ).toBe(false);
  });
});

describe('matchKeystroke: layouts', () => {
  it('matches a Latin binding on the Russian layout by the physical key', () => {
    expect(
      matches('Mod+K', press({ key: 'л', code: 'KeyK', ctrlKey: true })),
    ).toBe(true);
    expect(
      matches('Mod+,', press({ key: 'б', code: 'Comma', ctrlKey: true })),
    ).toBe(true);
    expect(
      matches('Mod+K', press({ key: 'л', code: 'KeyL', ctrlKey: true })),
    ).toBe(false);
  });

  it('treats an ASCII letter as authoritative on Dvorak and AZERTY', () => {
    // Dvorak: физическая KeyV выдаёт «k», физическая KeyK — «t»
    expect(
      matches('Mod+K', press({ key: 'k', code: 'KeyV', ctrlKey: true })),
    ).toBe(true);
    expect(
      matches('Mod+K', press({ key: 't', code: 'KeyK', ctrlKey: true })),
    ).toBe(false);
    // AZERTY: «a» там, где в US «q»
    expect(
      matches('Mod+Q', press({ key: 'a', code: 'KeyQ', ctrlKey: true })),
    ).toBe(false);
    expect(
      matches('Mod+A', press({ key: 'a', code: 'KeyQ', ctrlKey: true })),
    ).toBe(true);
  });

  it('matches digits on AZERTY by the physical key', () => {
    expect(
      matches('Mod+1', press({ key: '&', code: 'Digit1', ctrlKey: true })),
    ).toBe(true);
    expect(
      matches(
        'Mod+1',
        press({ key: '&', code: 'Digit1', ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(false);
  });

  it('matches macOS Option+letter and dead keys by code', () => {
    expect(
      matches(
        'Alt+E',
        press({ key: 'Dead', code: 'KeyE', altKey: true }),
        'mac',
      ),
    ).toBe(true);
    expect(
      matches('Alt+A', press({ key: 'å', code: 'KeyA', altKey: true }), 'mac'),
    ).toBe(true);
    // родная латинская буква на другой клавише без Alt — окончательна
    expect(
      matches('Mod+Z', press({ key: 'y', code: 'KeyZ', ctrlKey: true })),
    ).toBe(false);
    expect(
      matches('Mod+Y', press({ key: 'y', code: 'KeyZ', ctrlKey: true })),
    ).toBe(true);
  });

  it('accepts the implicit Shift of a symbol but not of a letter', () => {
    expect(
      matches('Mod++', press({ key: '+', ctrlKey: true, shiftKey: true })),
    ).toBe(true);
    expect(matches('Mod+/', press({ key: '/', ctrlKey: true }))).toBe(true);
    expect(
      matches('Mod+K', press({ key: 'K', ctrlKey: true, shiftKey: true })),
    ).toBe(false);
  });

  it('matches physical bindings only by code', () => {
    expect(
      matches('Mod+[KeyK]', press({ key: 'л', code: 'KeyK', ctrlKey: true })),
    ).toBe(true);
    expect(
      matches('Mod+[KeyK]', press({ key: 'k', code: 'KeyV', ctrlKey: true })),
    ).toBe(false);
  });

  it('matches named keys', () => {
    expect(matches('Enter', press({ key: 'Enter' }))).toBe(true);
    expect(matches('Space', press({ key: ' ' }))).toBe(true);
    expect(matches('Alt+Up', press({ key: 'ArrowUp', altKey: true }))).toBe(
      true,
    );
    expect(matches('F5', press({ key: 'F5' }))).toBe(true);
  });
});

describe('eventToKeystroke', () => {
  const record = (event: KeyEventLike, platform: Platform = 'linux') => {
    const stroke = eventToKeystroke(event);
    return stroke === null ? null : chordToText([stroke], platform);
  };

  it('ignores lone modifiers', () => {
    expect(record(press({ key: 'Control', ctrlKey: true }))).toBeNull();
    expect(record(press({ key: 'Shift', shiftKey: true }))).toBeNull();
    expect(record(press({ key: 'Meta', metaKey: true }))).toBeNull();
    expect(record(press({ key: 'AltGraph' }))).toBeNull();
  });

  it('records the logical key independent of layout', () => {
    expect(record(press({ key: 'k', code: 'KeyK', ctrlKey: true }))).toBe(
      'Mod+K',
    );
    expect(record(press({ key: 'л', code: 'KeyK', ctrlKey: true }))).toBe(
      'Mod+K',
    );
    expect(record(press({ key: 'k', code: 'KeyV', ctrlKey: true }))).toBe(
      'Mod+K',
    );
    expect(
      record(
        press({ key: 'K', code: 'KeyK', metaKey: true, shiftKey: true }),
        'mac',
      ),
    ).toBe('Mod+Shift+K');
    expect(
      record(
        press({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true }),
      ),
    ).toBe('Mod+Shift+1');
    expect(
      record(press({ key: 'Dead', code: 'KeyE', altKey: true }), 'mac'),
    ).toBe('Alt+E');
  });

  it('records named keys and falls back to the physical key', () => {
    expect(record(press({ key: 'ArrowUp', altKey: true }))).toBe('Alt+ArrowUp');
    expect(record(press({ key: ' ', ctrlKey: true }))).toBe('Mod+Space');
    expect(record(press({ key: 'F5' }))).toBe('F5');
    expect(record(press({ key: '1', code: 'Numpad1', ctrlKey: true }))).toBe(
      'Mod+1',
    );
    expect(
      record(press({ key: 'Unidentified', code: 'IntlBackslash' })),
    ).toBeNull();
    expect(record(press({ key: '§', code: 'IntlBackslash' }))).toBe('§');
    expect(record(press({ key: 'Dead', code: 'IntlBackslash' }))).toBe(
      '[IntlBackslash]',
    );
  });

  it('records what matches: recorded events trigger the same binding', () => {
    const events = [
      press({ key: 'л', code: 'KeyK', ctrlKey: true }),
      press({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true }),
      press({ key: 'ArrowLeft', altKey: true }),
    ];
    for (const event of events) {
      const stroke = eventToKeystroke(event)!;
      expect(matchKeystroke(event, stroke)).toBe(true);
    }
  });
});
