import { describe, expect, it } from 'vitest';
import type { KeyEventLike, Keystroke } from '@dolphy-app/keybindings';
import {
  createShortcutEditor,
  recordKeystroke,
} from '@/pages/settings/model/shortcut-editor.ts';
import {
  appCommand,
  extensionCommand,
  setupKeybindings,
} from './support/keybindings-fakes.ts';

const NOT_TYPING = '!inputFocus && !modalOpen';

const event = (
  init: Partial<KeyEventLike> & { key: string },
): KeyEventLike => ({
  code: '',
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...init,
});
const ctrl = (key: string, code = '') => event({ key, code, ctrlKey: true });

const names = (strokes: readonly Keystroke[]) => strokes.map(({ key }) => key);

describe('рекордер сочетаний', () => {
  const step = (strokes: Keystroke[], init: Parameters<typeof event>[0]) =>
    recordKeystroke(strokes, event(init));

  it('нажатие записывается; вторая комбинация продолжает цепочку; третья начинает заново', () => {
    const first = recordKeystroke([], ctrl('k', 'KeyK'));
    expect(first.kind).toBe('update');
    const one = first.kind === 'update' ? first.strokes : [];
    expect(names(one)).toEqual(['k']);
    const second = recordKeystroke(one, ctrl('s', 'KeyS'));
    const two = second.kind === 'update' ? second.strokes : [];
    expect(names(two)).toEqual(['k', 's']);
    const third = recordKeystroke(two, ctrl('d', 'KeyD'));
    expect(third.kind === 'update' ? names(third.strokes) : []).toEqual(['d']);
  });

  it('Escape при пустой записи — отмена, при непустой — записывается как клавиша', () => {
    expect(step([], { key: 'Escape' })).toEqual({ kind: 'cancel' });
    const recorded = recordKeystroke([], ctrl('k'));
    const strokes = recorded.kind === 'update' ? recorded.strokes : [];
    const next = recordKeystroke(strokes, event({ key: 'Escape' }));
    expect(next.kind === 'update' ? names(next.strokes) : []).toEqual([
      'k',
      'escape',
    ]);
  });

  it('Backspace и Delete без модификаторов очищают запись; с модификатором — записываются', () => {
    const recorded = recordKeystroke([], ctrl('k'));
    const strokes = recorded.kind === 'update' ? recorded.strokes : [];
    expect(recordKeystroke(strokes, event({ key: 'Backspace' }))).toEqual({
      kind: 'update',
      strokes: [],
    });
    expect(recordKeystroke(strokes, event({ key: 'Delete' }))).toEqual({
      kind: 'update',
      strokes: [],
    });
    const bound = recordKeystroke([], ctrl('Backspace'));
    expect(bound.kind === 'update' ? names(bound.strokes) : []).toEqual([
      'backspace',
    ]);
  });

  it('Tab проходит, одиночный модификатор и IME игнорируются', () => {
    expect(step([], { key: 'Tab' })).toEqual({ kind: 'ignore' });
    expect(step([], { key: 'Shift', shiftKey: true })).toEqual({
      kind: 'ignore',
    });
    expect(step([], { key: 'Control', ctrlKey: true })).toEqual({
      kind: 'ignore',
    });
    expect(step([], { key: 'k', ctrlKey: true, isComposing: true })).toEqual({
      kind: 'ignore',
    });
    // Ctrl+Tab записывается
    expect(step([], { key: 'Tab', ctrlKey: true }).kind).toBe('update');
  });

  it('русская раскладка: клавиша записывается по физической (к → K)', () => {
    const recorded = recordKeystroke([], ctrl('к', 'KeyK'));
    expect(recorded.kind === 'update' ? names(recorded.strokes) : []).toEqual([
      'k',
    ]);
  });
});

const base = () =>
  setupKeybindings({
    commands: [
      appCommand('app:a', {
        title: 'Alpha',
        keybindings: [{ key: 'Mod+1', when: NOT_TYPING }],
      }),
      appCommand('app:b', {
        title: 'Beta',
        keybindings: [{ key: 'Mod+2', when: NOT_TYPING }],
      }),
      extensionCommand('extension:x:c', { title: 'Gamma' }),
    ],
    extensions: [{ command: 'extension:x:c', key: 'Mod+Shift+G' }],
  });

const open = (
  ctx: ReturnType<typeof base>,
  command: string,
  previous: { key: string; when: string | null } | null,
  when = NOT_TYPING,
) => {
  const editor = createShortcutEditor(ctx);
  editor.open({ command, title: command, previous }, when);
  return editor;
};
const record = (editor: ReturnType<typeof open>, ...keys: string[]) => {
  for (const key of keys) editor.press(ctrl(key, `Key${key.toUpperCase()}`));
};

describe('редактор сочетания', () => {
  it('замена привязки на месте: сохраняется набор команды с изменением, условие берётся из поля', async () => {
    const ctx = base();
    const editor = open(ctx, 'app:a', { key: 'Mod+1', when: NOT_TYPING });
    record(editor, 'q');
    expect(editor.keyText.value).toBe('Mod+Q');
    expect(editor.canSave.value).toBe(true);
    editor.when.value = '  ';
    expect(await editor.save(false)).toBe(true);
    expect(ctx.user.save).toHaveBeenCalledWith({
      'app:a': [{ key: 'Mod+Q', when: null }],
    });
    expect(ctx.keybindings.primary('app:a')?.text).toBe('Mod+Q');
  });

  it('добавление второй привязки сохраняет действующие и ставит новую выше', async () => {
    const ctx = base();
    const editor = open(ctx, 'app:a', null);
    record(editor, 'q');
    await editor.save(false);
    expect(ctx.user.save).toHaveBeenCalledWith({
      'app:a': [
        { key: 'Mod+1', when: NOT_TYPING },
        { key: 'Mod+Q', when: NOT_TYPING },
      ],
    });
    expect(ctx.keybindings.primary('app:a')?.text).toBe('Mod+Q');
  });

  it('цепочка из двух сочетаний записывается через пробел', () => {
    const editor = open(base(), 'app:a', null);
    record(editor, 'k', 's');
    expect(editor.keyText.value).toBe('Mod+K Mod+S');
  });

  it('проверка условия вживую: синтаксис с позицией и правило печатающей клавиши', () => {
    const editor = open(base(), 'app:a', null, '');
    editor.press(event({ key: 'q', code: 'KeyQ' }));
    expect(editor.problem.value).toEqual({
      field: 'when',
      reason: 'typing',
      detail: 'typing',
    });
    expect(editor.canSave.value).toBe(false);
    editor.when.value = '!inputFocus';
    expect(editor.problem.value).toBeNull();
    editor.when.value = 'inputFocus &&';
    expect(editor.problem.value).toMatchObject({
      field: 'when',
      reason: 'syntax',
      detail: 'unexpected-end',
    });
    expect(editor.canSave.value).toBe(false);
  });

  it('нельзя сохранить без записи и повтор привязки команды', () => {
    const ctx = base();
    const editor = open(ctx, 'app:a', null);
    expect(editor.canSave.value).toBe(false);
    record(editor, '1');
    expect(editor.problem.value).toEqual({ field: 'key', reason: 'duplicate' });
    expect(editor.canSave.value).toBe(false);
  });

  it('пересечения показываются до сохранения: другая команда, победитель и признак пользовательской привязки', async () => {
    const ctx = base();
    const editor = open(ctx, 'app:a', { key: 'Mod+1', when: NOT_TYPING });
    record(editor, '2');
    expect(editor.conflicts.value).toEqual([
      {
        otherKey: 'app:b',
        otherTitle: 'Beta',
        kind: 'same',
        otherKeys: 'Ctrl+2',
        blocking: false,
      },
    ]);
    // привязка другой команды — пользовательская: сохранение без переназначения заблокировано движком
    await ctx.keybindings.save({
      'app:b': [{ key: 'Mod+2', when: NOT_TYPING }],
    });
    expect(editor.conflicts.value[0]?.blocking).toBe(true);
  });

  it('«Переназначить»: у другой команды привязка снимается в том же патче', async () => {
    const ctx = base();
    const editor = open(ctx, 'app:a', { key: 'Mod+1', when: NOT_TYPING });
    record(editor, '2');
    expect(await editor.save(true)).toBe(true);
    expect(ctx.user.save).toHaveBeenCalledOnce();
    expect(ctx.user.save).toHaveBeenCalledWith({
      'app:a': [{ key: 'Mod+2', when: NOT_TYPING }],
      'app:b': [],
    });
    expect(ctx.keybindings.conflicts.value).toEqual([]);
  });

  it('отказ движка сохраняется как причина и не закрывает набор; следующая запись очищает её', async () => {
    const ctx = base();
    ctx.user.state.reject = Object.assign(new Error('conflict'), {
      details: {
        reason: 'conflict',
        field: 'commands.app:a',
        command: 'app:a',
        other: 'app:b',
      },
    });
    const editor = open(ctx, 'app:a', null);
    record(editor, 'q');
    expect(await editor.save(false)).toBe(false);
    expect(editor.failure.value).toMatchObject({
      reason: 'conflict',
      command: 'app:a',
      other: 'app:b',
    });
    expect(editor.saving.value).toBe(false);
    record(editor, 'w');
    expect(editor.failure.value).toBeNull();
  });

  it('снятие привязки пишет набор без неё; снятие последней — пустой набор; отказ уходит в actionFailure', async () => {
    const ctx = base();
    const editor = createShortcutEditor(ctx);
    await editor.remove('app:a', { key: 'Mod+1', when: NOT_TYPING });
    expect(ctx.user.save).toHaveBeenCalledWith({ 'app:a': [] });
    expect(ctx.keybindings.bindingsFor('app:a')).toEqual([]);
    ctx.user.state.reject = Object.assign(new Error('down'), {
      details: { reason: 'limit' },
    });
    await editor.remove('app:b', { key: 'Mod+2', when: NOT_TYPING });
    expect(editor.actionFailure.value?.reason).toBe('limit');
  });

  it('сброс команды пишет null, сброс всего — null каждой команде набора', async () => {
    const ctx = base();
    const editor = createShortcutEditor(ctx);
    await ctx.keybindings.save({
      'app:a': [],
      'app:b': [{ key: 'Mod+Shift+B', when: null }],
    });
    await editor.reset('app:a');
    expect(ctx.user.save).toHaveBeenLastCalledWith({ 'app:a': null });
    await editor.resetAll();
    expect(ctx.user.save).toHaveBeenLastCalledWith({ 'app:b': null });
    expect(ctx.keybindings.isCustomized('app:b')).toBe(false);
  });

  it('привязка расширения при редактировании становится набором пользователя команды', async () => {
    const ctx = base();
    const editor = open(
      ctx,
      'extension:x:c',
      { key: 'Mod+Shift+G', when: null },
      '',
    );
    record(editor, 'h');
    await editor.save(false);
    expect(ctx.user.save).toHaveBeenCalledWith({
      'extension:x:c': [{ key: 'Mod+H', when: null }],
    });
    expect(ctx.keybindings.bindingsFor('extension:x:c')[0]?.source).toBe(
      'user',
    );
  });
});
