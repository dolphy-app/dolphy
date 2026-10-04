import { describe, expect, it } from 'vitest';
import {
  buildKeymap,
  findCandidateConflicts,
  parseChord,
  parseWhen,
} from '../src/index.ts';
import type {
  BindingDefinition,
  KeyEventLike,
  Keymap,
  Platform,
  UserKeybindings,
} from '../src/index.ts';

const press = (
  init: Partial<KeyEventLike> & { key: string },
): KeyEventLike => ({
  code: '',
  ctrlKey: true,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...init,
});

const make = (
  parts: {
    defaults?: BindingDefinition[];
    extensions?: BindingDefinition[];
    user?: UserKeybindings;
  },
  platform: Platform = 'linux',
) =>
  buildKeymap({
    platform,
    defaults: parts.defaults ?? [],
    extensions: parts.extensions ?? [],
    user: parts.user ?? {},
  });

const context = (values: Record<string, unknown>) => (key: string) =>
  values[key];

const run = (
  keymap: Keymap,
  presses: KeyEventLike[],
  values: Record<string, unknown> = {},
) => {
  const result = keymap.resolve(presses, context(values));
  return result.kind === 'none'
    ? 'none'
    : `${result.kind}:${result.binding.command}`;
};

describe('buildKeymap: sources and precedence', () => {
  it('ranks user over default over extension', () => {
    const keymap = make({
      defaults: [{ command: 'app:a', key: 'Mod+K' }],
      extensions: [{ command: 'extension:x:b', key: 'Mod+K' }],
    });
    expect(run(keymap, [press({ key: 'k' })])).toBe('run:app:a');

    const onlyExtension = make({
      extensions: [{ command: 'extension:x:b', key: 'Mod+K' }],
    });
    expect(run(onlyExtension, [press({ key: 'k' })])).toBe('run:extension:x:b');

    const withUser = make({
      defaults: [{ command: 'app:a', key: 'Mod+K' }],
      extensions: [{ command: 'extension:x:b', key: 'Mod+K' }],
      user: { 'app:c': [{ key: 'Mod+K', when: null }] },
    });
    expect(run(withUser, [press({ key: 'k' })])).toBe('run:app:c');
  });

  it('lets a later entry of the same source win', () => {
    const keymap = make({
      extensions: [
        { command: 'extension:a:one', key: 'Mod+J' },
        { command: 'extension:b:two', key: 'Mod+J' },
      ],
    });
    expect(run(keymap, [press({ key: 'j' })])).toBe('run:extension:b:two');
  });

  it('replaces defaults and extension bindings of a command by its user set', () => {
    const keymap = make({
      defaults: [{ command: 'app:a', key: 'Mod+1' }],
      extensions: [{ command: 'app:a', key: 'Mod+2' }],
      user: { 'app:a': [{ key: 'Mod+3', when: null }] },
    });
    expect(keymap.forCommand('app:a').map(({ text }) => text)).toEqual([
      'Mod+3',
    ]);
    expect(run(keymap, [press({ key: '1' })])).toBe('none');
    expect(run(keymap, [press({ key: '3' })])).toBe('run:app:a');
  });

  it('treats an empty user set as "unbound" and no entry as "default"', () => {
    const defaults = [{ command: 'app:a', key: 'Mod+1' }];
    expect(
      run(make({ defaults, user: { 'app:a': [] } }), [press({ key: '1' })]),
    ).toBe('none');
    expect(run(make({ defaults }), [press({ key: '1' })])).toBe('run:app:a');
  });

  it('keeps entries of unknown commands out of the map without failing', () => {
    const keymap = make({
      user: { 'extension:gone:cmd': [{ key: 'Mod+7', when: null }] },
    });
    expect(keymap.forCommand('extension:gone:cmd')).toHaveLength(1);
    expect(keymap.issues).toEqual([]);
  });

  it('picks the platform key of a definition', () => {
    const defaults = [
      { command: 'app:a', key: 'Mod+K', mac: 'Ctrl+Meta+K', linux: 'Alt+K' },
    ];
    expect(make({ defaults }, 'mac').forCommand('app:a')[0]?.text).toBe(
      'Ctrl+Meta+K',
    );
    expect(make({ defaults }, 'linux').forCommand('app:a')[0]?.text).toBe(
      'Alt+K',
    );
    expect(make({ defaults }, 'windows').forCommand('app:a')[0]?.text).toBe(
      'Mod+K',
    );
  });

  it('skips unparseable entries and reports them', () => {
    const keymap = make({
      defaults: [{ command: 'app:a', key: 'Mod+Foo' }],
      user: {
        'app:b': [
          { key: 'Mod+K', when: 'a &&' },
          { key: 'Mod+L', when: null },
        ],
      },
    });
    expect(keymap.bindings.map(({ command }) => command)).toEqual(['app:b']);
    expect(keymap.issues).toMatchObject([
      {
        source: 'default',
        command: 'app:a',
        field: 'key',
        reason: 'unknown-key',
      },
      {
        source: 'user',
        command: 'app:b',
        field: 'when',
        reason: 'unexpected-end',
      },
    ]);
  });
});

describe('Keymap.resolve', () => {
  it('uses the when clause as the scope of one key', () => {
    const keymap = make({
      defaults: [
        {
          command: 'app:session.grade',
          key: 'Mod+Enter',
          when: "page == 'session'",
        },
        {
          command: 'app:courses.open',
          key: 'Mod+Enter',
          when: "page == 'courses'",
        },
      ],
    });
    const enter = press({ key: 'Enter' });
    expect(run(keymap, [enter], { page: 'session' })).toBe(
      'run:app:session.grade',
    );
    expect(run(keymap, [enter], { page: 'courses' })).toBe(
      'run:app:courses.open',
    );
    expect(run(keymap, [enter], { page: 'graph' })).toBe('none');
  });

  it('falls through a higher binding whose when is false', () => {
    const keymap = make({
      defaults: [
        { command: 'app:general', key: 'Mod+K' },
        { command: 'app:special', key: 'Mod+K', when: 'special' },
      ],
    });
    expect(run(keymap, [press({ key: 'k' })], { special: true })).toBe(
      'run:app:special',
    );
    expect(run(keymap, [press({ key: 'k' })])).toBe('run:app:general');
  });

  it('skips disabled commands', () => {
    const keymap = make({
      defaults: [
        { command: 'app:a', key: 'Mod+K' },
        { command: 'app:b', key: 'Mod+K' },
      ],
    });
    const result = keymap.resolve(
      [press({ key: 'k' })],
      context({}),
      (c) => c !== 'app:b',
    );
    expect(result).toMatchObject({
      kind: 'run',
      binding: { command: 'app:a' },
    });
  });

  it('walks a two-step chord', () => {
    const keymap = make({
      defaults: [{ command: 'app:chord', key: 'Mod+K Mod+S' }],
    });
    const first = press({ key: 'k' });
    const second = press({ key: 's' });
    expect(run(keymap, [first])).toBe('pending:app:chord');
    expect(run(keymap, [first, second])).toBe('run:app:chord');
    expect(run(keymap, [first, press({ key: 'x' })])).toBe('none');
    expect(run(keymap, [second])).toBe('none');
  });

  it('lets a higher-priority single stroke make the chord unreachable', () => {
    const keymap = make({
      defaults: [{ command: 'app:chord', key: 'Mod+K Mod+S' }],
      user: { 'app:single': [{ key: 'Mod+K', when: null }] },
    });
    expect(run(keymap, [press({ key: 'k' })])).toBe('run:app:single');
  });

  it('awaits the chord of a higher-priority binding', () => {
    const keymap = make({
      defaults: [{ command: 'app:single', key: 'Mod+K' }],
      user: { 'app:chord': [{ key: 'Mod+K Mod+S', when: null }] },
    });
    expect(run(keymap, [press({ key: 'k' })])).toBe('pending:app:chord');
  });
});

describe('Keymap.conflicts', () => {
  const winnerAndLoser = (keymap: Keymap) =>
    keymap
      .conflicts()
      .map(
        ({ kind, winner, loser }) =>
          `${kind}:${winner.command}>${loser.command}`,
      )
      .sort();

  it('finds the same keys with overlapping conditions across commands', () => {
    const keymap = make({
      defaults: [
        { command: 'app:a', key: 'Mod+K' },
        { command: 'app:b', key: 'Mod+K', when: "page == 'courses'" },
        { command: 'app:c', key: 'Mod+K', when: "page == 'graph'" },
      ],
    });
    expect(winnerAndLoser(keymap)).toEqual([
      'same:app:b>app:a',
      'same:app:c>app:a',
    ]);
  });

  it('does not report disjoint conditions or bindings of one command', () => {
    const keymap = make({
      defaults: [
        { command: 'app:a', key: 'Mod+K', when: 'inputFocus' },
        { command: 'app:b', key: 'Mod+K', when: '!inputFocus' },
        { command: 'app:c', key: 'Mod+J' },
        { command: 'app:c', key: 'Mod+J', when: 'x' },
      ],
    });
    expect(keymap.conflicts()).toEqual([]);
  });

  it('treats physical and logical writes of one key as the same', () => {
    const keymap = make({
      defaults: [
        { command: 'app:a', key: 'Mod+K' },
        { command: 'app:b', key: 'Mod+[KeyK]' },
      ],
    });
    expect(winnerAndLoser(keymap)).toEqual(['same:app:b>app:a']);
  });

  it('finds a chord whose start is another binding', () => {
    const keymap = make({
      defaults: [
        { command: 'app:single', key: 'Mod+K' },
        { command: 'app:chord', key: 'Mod+K Mod+S' },
        { command: 'app:other', key: 'Mod+K Mod+D' },
      ],
    });
    // цепочки одной команды с другой различаются второй клавишей: между собой не конфликтуют
    expect(winnerAndLoser(keymap)).toEqual([
      'prefix:app:chord>app:single',
      'prefix:app:other>app:single',
    ]);
  });

  it('names the winner by source priority', () => {
    const keymap = make({
      defaults: [{ command: 'app:a', key: 'Mod+K' }],
      extensions: [{ command: 'extension:x:b', key: 'Mod+K' }],
    });
    expect(winnerAndLoser(keymap)).toEqual(['same:app:a>extension:x:b']);
  });
});

describe('findCandidateConflicts', () => {
  const keymap = make({
    defaults: [
      { command: 'app:go.courses', key: 'Mod+2', when: '!modalOpen' },
      { command: 'app:go.graph', key: 'Mod+3' },
      { command: 'app:chord', key: 'Mod+K Mod+S' },
    ],
  });
  const candidate = (
    command: string,
    key: string,
    when: string | null = null,
  ) => ({
    command,
    chord: parseChord(key, 'linux'),
    when: when === null ? null : parseWhen(when),
  });

  it('lists the bindings of other commands the candidate collides with', () => {
    const conflicts = findCandidateConflicts(
      keymap,
      candidate('app:new', 'Mod+2'),
    );
    expect(conflicts.map(({ loser }) => loser.command)).toEqual([
      'app:go.courses',
    ]);
    expect(conflicts[0]?.winner.command).toBe('app:new');
  });

  it('ignores the own command, disjoint conditions and free keys', () => {
    expect(
      findCandidateConflicts(keymap, candidate('app:go.courses', 'Mod+2')),
    ).toEqual([]);
    expect(
      findCandidateConflicts(
        keymap,
        candidate('app:new', 'Mod+2', 'modalOpen'),
      ),
    ).toEqual([]);
    expect(
      findCandidateConflicts(keymap, candidate('app:new', 'Mod+9')),
    ).toEqual([]);
  });

  it('reports a prefix collision with a chord', () => {
    const conflicts = findCandidateConflicts(
      keymap,
      candidate('app:new', 'Mod+K'),
    );
    expect(
      conflicts.map(({ kind, loser }) => `${kind}:${loser.command}`),
    ).toEqual(['prefix:app:chord']);
  });
});
