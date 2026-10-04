import { describe, expect, it } from 'vitest';
import { describeChord } from '@/features/keybindings';
import {
  appCommand,
  extensionCommand,
  setupKeybindings,
} from './support/keybindings-fakes.ts';

const NOT_TYPING = '!inputFocus && !modalOpen';

const base = () => ({
  commands: [
    appCommand('app:a', { keybindings: [{ key: 'Mod+K' }] }),
    appCommand('app:b', { keybindings: [{ key: 'Mod+J', when: NOT_TYPING }] }),
    extensionCommand('extension:x:c'),
  ],
  extensions: [{ command: 'extension:x:c', key: 'Mod+J' }],
});

const winner = (conflicts: readonly { winner: { command: string } }[]) =>
  conflicts.map((conflict) => conflict.winner.command);

describe('сервис привязок: источники и приоритет', () => {
  it('умолчание команды приложения побеждает вклад расширения; пользователь побеждает умолчание', () => {
    const { keybindings, user } = setupKeybindings(base());
    expect(winner(keybindings.conflicts.value)).toEqual(['app:b']);
    user.stored.value = { 'extension:x:c': [{ key: 'Mod+J', when: null }] };
    expect(winner(keybindings.conflicts.value)).toEqual(['extension:x:c']);
    expect(keybindings.bindingsFor('extension:x:c')[0]?.source).toBe('user');
  });

  it('набор пользователя заменяет умолчания и вклады команды; пустой набор — привязок нет; сброс возвращает прежние', async () => {
    const { keybindings } = setupKeybindings(base());
    expect(keybindings.isCustomized('app:b')).toBe(false);
    await keybindings.save({ 'app:b': [{ key: 'Mod+Shift+B', when: null }] });
    expect(keybindings.isCustomized('app:b')).toBe(true);
    expect(keybindings.bindingsFor('app:b').map(({ text }) => text)).toEqual([
      'Mod+Shift+B',
    ]);
    await keybindings.save({ 'app:b': [] });
    expect(keybindings.bindingsFor('app:b')).toEqual([]);
    expect(keybindings.primary('app:b')).toBeUndefined();
    await keybindings.reset('app:b');
    expect(keybindings.bindingsFor('app:b').map(({ text }) => text)).toEqual([
      'Mod+J',
    ]);
  });

  it('привязки команды, которой сейчас нет, хранятся в карте и не исчезают', () => {
    const { keybindings, registry } = setupKeybindings({
      ...base(),
      user: { 'extension:gone:cmd': [{ key: 'Mod+Shift+Z', when: null }] },
    });
    expect(keybindings.bindingsFor('extension:gone:cmd')).toHaveLength(1);
    expect(registry.list.value.map(({ key }) => key)).not.toContain(
      'extension:gone:cmd',
    );
  });

  it('привязки расширений следуют за списком без перерегистрации команд', () => {
    const { keybindings, setExtensions } = setupKeybindings(base());
    expect(keybindings.bindingsFor('extension:x:c')).toHaveLength(1);
    setExtensions([{ command: 'extension:x:c', key: 'Mod+Shift+G' }]);
    expect(keybindings.primary('extension:x:c')?.text).toBe('Mod+Shift+G');
    setExtensions([]);
    expect(keybindings.bindingsFor('extension:x:c')).toEqual([]);
  });

  it('ключи платформ заменяют key; Mod строго по платформе', () => {
    const input = {
      commands: [extensionCommand('extension:x:c')],
      extensions: [{ command: 'extension:x:c', key: 'Mod+G', mac: 'Ctrl+G' }],
    };
    const windows = setupKeybindings({ ...input, platform: 'windows' });
    const mac = setupKeybindings({ ...input, platform: 'mac' });
    expect(windows.keybindings.entriesOf('extension:x:c')).toEqual([
      { key: 'Mod+G', when: null },
    ]);
    // на macOS Mod — ⌘, а Ctrl остаётся Ctrl
    expect(mac.keybindings.entriesOf('extension:x:c')).toEqual([
      { key: 'Ctrl+G', when: null },
    ]);
  });
});

describe('сервис привязок: палитра показывает действующую привязку (R22)', () => {
  it('основная привязка следует за платформой и набором пользователя', async () => {
    const word = (id: string) => id;
    const text = (setup: ReturnType<typeof setupKeybindings>) => {
      const binding = setup.keybindings.primary('app:a');
      return binding === undefined
        ? null
        : describeChord(binding.chord, setup.keybindings.platform, word).keys;
    };
    const windows = setupKeybindings({ ...base(), platform: 'windows' });
    const mac = setupKeybindings({ ...base(), platform: 'mac' });
    expect(text(windows)).toBe('Ctrl+K');
    expect(text(mac)).toBe('⌘K');
    await windows.keybindings.save({
      'app:a': [{ key: 'Mod+Shift+P', when: null }],
    });
    expect(text(windows)).toBe('Ctrl+Shift+P');
    await windows.keybindings.save({ 'app:a': [] });
    expect(text(windows)).toBeNull();
  });

  it('при нескольких привязках основная — с наибольшим приоритетом (позднее в источнике выше)', () => {
    const { keybindings } = setupKeybindings({
      commands: [
        appCommand('app:a', {
          keybindings: [{ key: 'Mod+1' }, { key: 'Mod+2' }],
        }),
      ],
    });
    expect(keybindings.primary('app:a')?.text).toBe('Mod+2');
    expect(keybindings.entriesOf('app:a').map(({ key }) => key)).toEqual([
      'Mod+1',
      'Mod+2',
    ]);
  });
});

describe('сервис привязок: пересечения до сохранения', () => {
  it('находит привязки других команд: одинаковые клавиши и начало цепочки', () => {
    const { keybindings } = setupKeybindings(base());
    const same = keybindings.candidateConflicts('app:a', 'Mod+J', null);
    expect(same.map(({ kind, other }) => [kind, other.command])).toEqual([
      ['same', 'app:b'],
      ['same', 'extension:x:c'],
    ]);
    const prefix = keybindings.candidateConflicts('app:a', 'Mod+J Mod+K', null);
    expect(prefix.map(({ kind }) => kind)).toEqual(['prefix', 'prefix']);
  });

  it('учитывает условие и не сравнивает команду с самой собой; непонятная запись — пусто', () => {
    const { keybindings } = setupKeybindings(base());
    // `inputFocus` и `!inputFocus` не пересекаются; вклад расширения без условия пересекается
    expect(
      keybindings
        .candidateConflicts('app:a', 'Mod+J', 'inputFocus')
        .map(({ other }) => other.command),
    ).toEqual(['extension:x:c']);
    expect(keybindings.candidateConflicts('app:b', 'Mod+J', null)).toHaveLength(
      1,
    );
    expect(keybindings.candidateConflicts('app:a', 'Mod+', null)).toEqual([]);
    expect(keybindings.candidateConflicts('app:a', 'Mod+J', 'a &&')).toEqual(
      [],
    );
  });
});

describe('сервис привязок: патч сохранения', () => {
  it('без переназначения пишет только набор команды', () => {
    const { keybindings } = setupKeybindings(base());
    expect(
      keybindings.buildPatch('app:a', [{ key: 'Mod+J', when: null }], false),
    ).toEqual({ 'app:a': [{ key: 'Mod+J', when: null }] });
  });

  it('переназначение снимает пересекающиеся привязки у других команд в том же патче и сохраняет остальные', () => {
    const { keybindings } = setupKeybindings({
      commands: [
        ...base().commands.slice(0, 1),
        appCommand('app:b', {
          keybindings: [
            { key: 'Mod+J', when: NOT_TYPING },
            { key: 'Mod+L', when: NOT_TYPING },
          ],
        }),
        extensionCommand('extension:x:c'),
      ],
      extensions: base().extensions,
    });
    const patch = keybindings.buildPatch(
      'app:a',
      [{ key: 'Mod+J', when: null }],
      true,
    );
    expect(patch).toEqual({
      'app:a': [{ key: 'Mod+J', when: null }],
      // остаётся только непересекающаяся привязка, набор пользователя заменяет умолчания
      'app:b': [{ key: 'Mod+L', when: NOT_TYPING }],
      // единственная привязка расширения снята: пустой набор
      'extension:x:c': [],
    });
  });

  it('переназначенный патч применяется и освобождает клавишу', async () => {
    const { keybindings } = setupKeybindings(base());
    await keybindings.save(
      keybindings.buildPatch('app:a', [{ key: 'Mod+J', when: null }], true),
    );
    expect(keybindings.conflicts.value).toEqual([]);
    expect(keybindings.primary('app:a')?.text).toBe('Mod+J');
    expect(keybindings.bindingsFor('app:b')).toEqual([]);
  });

  it('сброс всего пишет null каждой команде набора; без набора — ничего не вызывает', async () => {
    const { keybindings, user } = setupKeybindings({
      ...base(),
      user: {
        'app:a': [{ key: 'Mod+Shift+A', when: null }],
        'app:b': [],
      },
    });
    await keybindings.resetAll();
    expect(user.save).toHaveBeenCalledExactlyOnceWith({
      'app:a': null,
      'app:b': null,
    });
    await keybindings.resetAll();
    expect(user.save).toHaveBeenCalledOnce();
  });
});
