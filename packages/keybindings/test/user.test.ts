import { describe, expect, it } from 'vitest';
import {
  decodeUserKeybindings,
  KEYBINDING_LIMITS,
  validateBinding,
  validateUserKeybindings,
} from '../src/index.ts';
import type { UserKeybindings } from '../src/index.ts';

const entry = (key: string, when: string | null = null) => ({ key, when });

describe('validateBinding', () => {
  it.each([
    ['Mod+K', null, null],
    ['Mod+K Mod+S', null, null],
    ['F5', null, null],
    ['Escape', null, null],
    ['K', '!inputFocus', null],
    ['Shift+K', '!inputFocus && !modalOpen', null],
    ['Enter', "page == 'session' && !inputFocus", null],
    ['K', null, 'typing'],
    ['K', 'page == courses', 'typing'],
    ['K', 'inputFocus || !inputFocus', 'typing'],
    ['ArrowLeft', 'modalOpen', 'typing'],
    ['Mod+K', 'a &&', 'syntax'],
    ['Mod+Foo', null, 'syntax'],
    ['', null, 'syntax'],
  ])('%s when %s → %s', (key, when, expected) => {
    expect(validateBinding({ key, when }, ['linux'])?.reason ?? null).toBe(
      expected,
    );
  });

  it('checks the key on every given platform', () => {
    const binding = { key: 'Mod+Ctrl+K', when: null };
    expect(validateBinding(binding, ['mac'])).toBeNull();
    expect(validateBinding(binding, ['mac', 'linux'])).toMatchObject({
      field: 'key',
      detail: 'repeated-modifier',
    });
  });

  it('points at the position of a when-clause error', () => {
    expect(
      validateBinding({ key: 'Mod+K', when: 'a && )' }, ['linux']),
    ).toMatchObject({
      field: 'when',
      reason: 'syntax',
      position: 5,
    });
  });

  it('rejects an over-long key', () => {
    expect(
      validateBinding({ key: `Mod+${'K'.repeat(100)}`, when: null }, ['linux'])
        ?.reason,
    ).toBe('syntax');
  });
});

describe('decodeUserKeybindings', () => {
  it('reads a well-formed value', () => {
    const raw = {
      commands: {
        'app:a': [{ key: 'Mod+K', when: '!inputFocus' }, { key: 'Mod+J' }],
      },
    };
    expect(decodeUserKeybindings(raw)).toEqual({
      'app:a': [entry('Mod+K', '!inputFocus'), entry('Mod+J')],
    });
  });

  it.each([
    null,
    undefined,
    5,
    'x',
    [],
    { commands: null },
    { commands: [] },
    {},
  ])('returns nothing for %j', (raw) => {
    expect(decodeUserKeybindings(raw)).toEqual({});
  });

  it('drops what cannot be read and keeps the rest', () => {
    const raw = {
      commands: {
        'app:ok': [
          { key: 'Mod+1', when: null },
          { key: 5 },
          'x',
          null,
          { key: 'Mod+2', when: 7 },
        ],
        'app:not-array': 'Mod+K',
        'bad key': [{ key: 'Mod+K', when: null }],
        __proto__: [{ key: 'Mod+K', when: null }],
        'app:empty': [],
      },
    };
    const decoded = decodeUserKeybindings(JSON.parse(JSON.stringify(raw)));
    expect(decoded).toEqual({ 'app:ok': [entry('Mod+1')], 'app:empty': [] });
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
  });

  it('cuts entries and commands to the limits', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      key: `F${i + 1}`,
      when: null,
    }));
    const commands = Object.fromEntries(
      Array.from({ length: KEYBINDING_LIMITS.commands + 5 }, (_, i) => [
        `app:c${i}`,
        [],
      ]),
    );
    expect(
      decodeUserKeybindings({ commands: { 'app:a': many } })['app:a'],
    ).toHaveLength(KEYBINDING_LIMITS.entriesPerCommand);
    expect(Object.keys(decodeUserKeybindings({ commands }))).toHaveLength(
      KEYBINDING_LIMITS.commands,
    );
  });
});

describe('validateUserKeybindings', () => {
  const issues = (user: UserKeybindings, platform: 'linux' | 'mac' = 'linux') =>
    validateUserKeybindings(user, platform).map(
      ({ reason, field }) => `${reason}:${field}`,
    );

  it('accepts a valid set, including the same key under disjoint conditions', () => {
    expect(
      issues({
        'app:a': [entry('Mod+K'), entry('Mod+Shift+K')],
        'app:b': [entry('Mod+J', 'inputFocus')],
        'app:c': [entry('Mod+J', '!inputFocus')],
        'app:d': [],
      }),
    ).toEqual([]);
  });

  it('reports syntax, typing and duplicate problems with their path', () => {
    expect(
      issues({
        'app:a': [entry('Mod+Foo'), entry('K'), entry('Mod+K', 'a &&')],
        'app:b': [
          entry('Mod+L'),
          entry('Ctrl+L'),
          entry('Mod+M', 'x'),
          entry('Mod+M', ' x '),
        ],
      }),
    ).toEqual([
      'syntax:commands.app:a[0].key',
      'typing:commands.app:a[1].when',
      'syntax:commands.app:a[2].when',
      'duplicate:commands.app:b[1]',
      'duplicate:commands.app:b[3]',
    ]);
  });

  it('reports a conflict between two commands, naming both', () => {
    const [issue] = validateUserKeybindings(
      { 'app:a': [entry('Mod+K')], 'app:b': [entry('Ctrl+K')] },
      'linux',
    );
    expect(issue).toMatchObject({
      reason: 'conflict',
      command: 'app:a',
      other: 'app:b',
    });
  });

  it('resolves Mod by the host platform when looking for conflicts', () => {
    const user = { 'app:a': [entry('Mod+K')], 'app:b': [entry('Ctrl+K')] };
    expect(issues(user, 'linux')).toEqual(['conflict:commands.app:a']);
    expect(issues(user, 'mac')).toEqual([]);
  });

  it('reports a chord whose start is bound by another command', () => {
    expect(
      validateUserKeybindings(
        { 'app:a': [entry('Mod+K')], 'app:b': [entry('Mod+K Mod+S')] },
        'linux',
      ).map(({ reason }) => reason),
    ).toEqual(['conflict']);
  });

  it('enforces limits and command key form', () => {
    const tooMany = Array.from({ length: 9 }, (_, i) => entry(`F${i + 1}`));
    expect(issues({ 'app:a': tooMany })).toContain('limit:commands.app:a');
    expect(issues({ nope: [] })).toEqual(['syntax:commands.nope']);
    expect(issues({ [`app:${'x'.repeat(250)}`]: [] })[0]).toMatch(/^limit:/);
    const commands = Object.fromEntries(
      Array.from({ length: KEYBINDING_LIMITS.commands + 1 }, (_, i) => [
        `app:c${i}`,
        [],
      ]),
    );
    expect(issues(commands)).toContain('limit:commands');
  });
});
