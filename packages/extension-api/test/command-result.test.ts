import { describe, expect, it } from 'vitest';
import {
  EXTENSION_COMMAND_LIMITS,
  InvalidCommandResultError,
  KEYBINDING_PATTERN,
  normalizeCommandResult,
} from '../src/index.ts';

const rejects = (raw: unknown, panels?: readonly string[]) => {
  expect(() => normalizeCommandResult(raw, panels)).toThrow(
    InvalidCommandResultError,
  );
};

describe('normalizeCommandResult', () => {
  it('undefined и null — ничего', () => {
    expect(normalizeCommandResult(undefined, undefined)).toEqual({
      kind: 'none',
    });
    expect(normalizeCommandResult(null, undefined)).toEqual({ kind: 'none' });
  });

  it('notify: строка 1–500 символов', () => {
    expect(normalizeCommandResult({ notify: 'x' }, undefined)).toEqual({
      kind: 'notify',
      text: 'x',
    });
    const longest = 'я'.repeat(EXTENSION_COMMAND_LIMITS.notifyChars);
    expect(normalizeCommandResult({ notify: longest }, undefined)).toEqual({
      kind: 'notify',
      text: longest,
    });
  });

  it('notify: пустая, длиннее 500, не строка или с чужим ключом — ошибка', () => {
    rejects({ notify: '' });
    rejects({ notify: 'x'.repeat(501) });
    rejects({ notify: 5 });
    rejects({ notify: null });
    rejects({ notify: 'x', extra: 1 });
    rejects({ notify: 'x', openPanel: 'p' });
  });

  it('openPanel: без props ключа props нет, с props он сохраняется', () => {
    const bare = normalizeCommandResult({ openPanel: 'p' }, ['p']);
    expect(bare).toEqual({ kind: 'openPanel', panelId: 'p' });
    expect('props' in bare).toBe(false);
    expect(
      normalizeCommandResult({ openPanel: 'p', props: { a: [1] } }, ['p']),
    ).toEqual({ kind: 'openPanel', panelId: 'p', props: { a: [1] } });
    expect(normalizeCommandResult({ openPanel: 'p', props: 0 }, ['p'])).toEqual(
      { kind: 'openPanel', panelId: 'p', props: 0 },
    );
  });

  it('openPanel: панель вне списка — ошибка, без списка годится любая строка', () => {
    rejects({ openPanel: 'other' }, ['p']);
    rejects({ openPanel: 'p' }, []);
    expect(normalizeCommandResult({ openPanel: 'any' }, undefined)).toEqual({
      kind: 'openPanel',
      panelId: 'any',
    });
  });

  it('openPanel: чужой ключ и не строка — ошибка', () => {
    rejects({ openPanel: 'p', extra: 1 }, ['p']);
    rejects({ openPanel: 7 });
    rejects({ openPanel: null });
  });

  it('прочий JSON — data', () => {
    for (const value of [[1, 2], 42, 'text', true, { a: 1, b: [null] }]) {
      expect(normalizeCommandResult(value, undefined)).toEqual({
        kind: 'data',
        value,
      });
    }
  });

  it('объект, лишь содержащий ключ notifyMe, — data', () => {
    expect(normalizeCommandResult({ notifyMe: 'x' }, undefined)).toEqual({
      kind: 'data',
      value: { notifyMe: 'x' },
    });
  });

  it('не JSON — ошибка', () => {
    rejects(() => 1);
    rejects(10n);
    rejects(Symbol('s'));
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    rejects(circular);
  });

  it('поля undefined отбрасываются', () => {
    expect(normalizeCommandResult({ a: 1, b: undefined }, undefined)).toEqual({
      kind: 'data',
      value: { a: 1 },
    });
    // props: undefined не делает из openPanel «эффект с props»
    const outcome = normalizeCommandResult(
      { openPanel: 'p', props: undefined },
      ['p'],
    );
    expect(outcome).toEqual({ kind: 'openPanel', panelId: 'p' });
    expect('props' in outcome).toBe(false);
  });

  it('потолок результата считается в байтах UTF-8, а не в символах', () => {
    const limit = EXTENSION_COMMAND_LIMITS.resultBytes;
    // JSON-текст строки: две кавычки + содержимое
    const cyrillic = (bytes: number) => 'я'.repeat((bytes - 2) / 2);
    const exact = cyrillic(limit);
    expect(exact.length).toBeLessThan(limit);
    expect(normalizeCommandResult(exact, undefined)).toEqual({
      kind: 'data',
      value: exact,
    });
    rejects(`${exact}я`);

    // эмодзи — 4 байта и две кодовые единицы UTF-16
    const emojis = '\u{1F600}'.repeat((limit - 4) / 4);
    expect(emojis.length).toBe((limit - 4) / 2);
    expect(normalizeCommandResult(`${emojis}ab`, undefined).kind).toBe('data');
    rejects(`${emojis}abc`);

    // ASCII: ровно 65536 байт проходит, 65537 — нет
    expect(normalizeCommandResult('a'.repeat(limit - 2), undefined).kind).toBe(
      'data',
    );
    rejects('a'.repeat(limit - 1));
  });
});

describe('KEYBINDING_PATTERN', () => {
  it.each([
    'Mod+Shift+L',
    'Ctrl+Alt+Delete',
    'Mod+Alt+Shift+7',
    'L',
    'F12',
    'Alt+F1',
    'Mod+Space',
    'Mod+ArrowUp',
    'Shift+PageDown',
  ])('принимает %s', (value) => {
    expect(KEYBINDING_PATTERN.test(value)).toBe(true);
  });

  it.each([
    'mod+l',
    'Mod+',
    '',
    'Mod+Shift+Alt+Ctrl+L',
    'L+Mod',
    'Mod+ab',
    'Mod+F13',
    'Mod+F0',
    'Mod+Shift+',
    'Meta+L',
  ])('отвергает %j', (value) => {
    expect(KEYBINDING_PATTERN.test(value)).toBe(false);
  });
});
