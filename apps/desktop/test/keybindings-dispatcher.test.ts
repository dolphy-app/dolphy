// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAPTURE_ATTRIBUTE,
  createKeybindingDispatcher,
} from '@/features/keybindings';
import type { Timers } from '@/features/keybindings';
import { createContextKeys } from '@/shared/lib/context-keys.ts';
import {
  appCommand,
  extensionCommand,
  setupKeybindings,
} from './support/keybindings-fakes.ts';
import type { KeybindingsSetup } from './support/keybindings-fakes.ts';

const NOT_TYPING = '!inputFocus && !modalOpen';

/** Время вручную: `fire` выполняет отложенный таймер. */
const createFakeTimers = () => {
  const pending = new Map<number, () => void>();
  let next = 1;
  const timers: Timers = {
    set: (callback) => {
      pending.set(next, callback);
      return next++;
    },
    clear: (handle) => void pending.delete(handle as number),
  };
  return {
    timers,
    count: () => pending.size,
    fire: () => {
      for (const [id, callback] of [...pending]) {
        pending.delete(id);
        callback();
      }
    },
  };
};

const setup = (input: KeybindingsSetup = {}) => {
  const run = vi.fn();
  const palette = vi.fn();
  const base = setupKeybindings({
    commands: [
      appCommand('app:palette.open', {
        keybindings: [{ key: 'Mod+K' }],
        run: palette,
      }),
      appCommand('app:settings', {
        keybindings: [{ key: 'Mod+,', when: NOT_TYPING }],
        run,
      }),
      ...(input.commands ?? []),
    ],
    ...(input.extensions && { extensions: input.extensions }),
    ...(input.user && { user: input.user }),
    platform: input.platform ?? 'windows',
  });
  const time = createFakeTimers();
  const contextKeys = createContextKeys(base.keybindings.platform, document);
  const reportFailure = vi.fn();
  const dispatcher = createKeybindingDispatcher({
    registry: base.registry,
    keybindings: base.keybindings,
    contextKeys,
    timers: time.timers,
    reportFailure,
  });
  const stop = dispatcher.install(document);
  return {
    ...base,
    run,
    palette,
    time,
    contextKeys,
    dispatcher,
    stop,
    reportFailure,
  };
};

const press = (target: EventTarget, init: KeyboardEventInit): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
};
const ctrl = (key: string, extra: KeyboardEventInit = {}) => ({
  key,
  ctrlKey: true,
  ...extra,
});

let stop: () => void = () => undefined;
beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => stop());

describe('диспетчер: выполнение привязок', () => {
  it('выполняет команду по привязке и гасит действие по умолчанию только для обработанного сочетания', () => {
    const ctx = setup();
    stop = ctx.stop;
    const handled = press(document.body, ctrl(','));
    expect(ctx.run).toHaveBeenCalledOnce();
    expect(handled.defaultPrevented).toBe(true);
    const ignored = press(document.body, ctrl('j'));
    expect(ctx.run).toHaveBeenCalledOnce();
    expect(ignored.defaultPrevented).toBe(false);
  });

  it('палитра — обычная команда: Mod+K срабатывает и в поле ввода, и над диалогом, а сочетания с `!inputFocus` — нет', () => {
    const ctx = setup();
    stop = ctx.stop;
    document.body.innerHTML =
      '<div class="v-dialog v-overlay--active"><input id="f"></div>';
    const field = document.getElementById('f')!;
    press(field, ctrl('k'));
    expect(ctx.palette).toHaveBeenCalledOnce();
    const blocked = press(field, ctrl(','));
    expect(ctx.run).not.toHaveBeenCalled();
    expect(blocked.defaultPrevented).toBe(false);
  });

  it.each([
    '<input id="f">',
    '<textarea id="f"></textarea>',
    '<select id="f"></select>',
    '<div id="f" contenteditable="true"></div>',
    '<div contenteditable="true"><span id="f">x</span></div>',
  ])('`!inputFocus`: не срабатывает при вводе в %s', (html) => {
    const ctx = setup();
    stop = ctx.stop;
    document.body.innerHTML = html;
    press(document.getElementById('f')!, ctrl(','));
    expect(ctx.run).not.toHaveBeenCalled();
  });

  it.each([
    '<div class="v-dialog v-overlay--active"></div>',
    '<div class="v-menu v-overlay--active"></div>',
    '<div role="dialog" aria-modal="true"></div>',
  ])('`!modalOpen`: не срабатывает при открытом %s', (html) => {
    const ctx = setup();
    stop = ctx.stop;
    document.body.innerHTML = html;
    press(document.body, ctrl(','));
    expect(ctx.run).not.toHaveBeenCalled();
  });

  it('снэкбар не блокирует сочетания', () => {
    const ctx = setup();
    stop = ctx.stop;
    document.body.innerHTML =
      '<div class="v-snackbar v-overlay--active"></div>';
    press(document.body, ctrl(','));
    expect(ctx.run).toHaveBeenCalledOnce();
  });

  it('игнорирует повтор клавиши, ввод через IME и уже обработанные события', () => {
    const ctx = setup();
    stop = ctx.stop;
    const repeated = press(document.body, ctrl(',', { repeat: true }));
    press(document.body, ctrl('k', { repeat: true }));
    press(document.body, ctrl(',', { isComposing: true }));
    // событие, которое кто-то раньше диспетчера уже обработал (слушатель окна в фазе перехвата идёт первым)
    const claim = (event: Event) => event.preventDefault();
    window.addEventListener('keydown', claim, true);
    press(document.body, ctrl('k'));
    window.removeEventListener('keydown', claim, true);
    expect(ctx.run).not.toHaveBeenCalled();
    expect(ctx.palette).not.toHaveBeenCalled();
    expect(repeated.defaultPrevented).toBe(false);
  });

  it('пропускает недоступные команды', () => {
    const run = vi.fn();
    const ctx = setup({
      commands: [
        appCommand('app:off', {
          keybindings: [{ key: 'Mod+L', when: NOT_TYPING }],
          enabled: false,
          run,
        }),
      ],
    });
    stop = ctx.stop;
    const event = press(document.body, ctrl('l'));
    expect(run).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('условие по разделу и сессии читается в момент нажатия', () => {
    const run = vi.fn();
    const ctx = setup({
      commands: [
        appCommand('app:here', {
          keybindings: [
            { key: 'Mod+H', when: "page == 'courses' && !inSession" },
          ],
          run,
        }),
      ],
    });
    stop = ctx.stop;
    press(document.body, ctrl('h'));
    expect(run).not.toHaveBeenCalled();
    ctx.contextKeys.page.value = 'courses';
    press(document.body, ctrl('h'));
    expect(run).toHaveBeenCalledOnce();
    ctx.contextKeys.inSession.value = true;
    press(document.body, ctrl('h'));
    expect(run).toHaveBeenCalledOnce();
  });

  it('команда расширения запускается тем же путём (через реестр) по привязке из вклада', () => {
    const run = vi.fn();
    const ctx = setup({
      commands: [extensionCommand('extension:acme:greet', { run })],
      extensions: [{ command: 'extension:acme:greet', key: 'Mod+Shift+G' }],
    });
    stop = ctx.stop;
    const event = press(document.body, ctrl('G', { shiftKey: true }));
    expect(run).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    // привязка пропала вместе с вкладом — клавиша свободна
    ctx.setExtensions([]);
    press(document.body, ctrl('G', { shiftKey: true }));
    expect(run).toHaveBeenCalledOnce();
  });

  it('набор пользователя переназначает палитру: старая клавиша свободна, новая работает', async () => {
    const ctx = setup();
    stop = ctx.stop;
    await ctx.keybindings.save({
      'app:palette.open': [{ key: 'Mod+P', when: null }],
    });
    const old = press(document.body, ctrl('k'));
    expect(ctx.palette).not.toHaveBeenCalled();
    expect(old.defaultPrevented).toBe(false);
    press(document.body, ctrl('p'));
    expect(ctx.palette).toHaveBeenCalledOnce();
  });

  it('на macOS Mod — ⌘: Ctrl+K не открывает палитру', () => {
    const ctx = setup({ platform: 'mac' });
    stop = ctx.stop;
    press(document.body, ctrl('k'));
    expect(ctx.palette).not.toHaveBeenCalled();
    press(document.body, { key: 'k', metaKey: true });
    expect(ctx.palette).toHaveBeenCalledOnce();
  });

  it('нажатия в области записи сочетания командам не отдаются', () => {
    const ctx = setup();
    stop = ctx.stop;
    document.body.innerHTML = `<div ${CAPTURE_ATTRIBUTE} tabindex="0"><span id="f"></span></div>`;
    const event = press(document.getElementById('f')!, ctrl('k'));
    expect(ctx.palette).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('сбой команды уходит в reportFailure, а не в необработанный промис', async () => {
    const failing = vi.fn(async () => {
      throw new Error('boom');
    });
    const ctx = setup({
      commands: [
        appCommand('app:bad', {
          keybindings: [{ key: 'Mod+B', when: NOT_TYPING }],
          run: failing,
        }),
      ],
    });
    stop = ctx.stop;
    press(document.body, ctrl('b'));
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(ctx.reportFailure).toHaveBeenCalledOnce();
  });

  it('после снятия обработчика клавиши не обрабатываются', () => {
    const ctx = setup();
    ctx.stop();
    stop = () => undefined;
    press(document.body, ctrl('k'));
    expect(ctx.palette).not.toHaveBeenCalled();
  });
});

describe('диспетчер: цепочки', () => {
  const chordSetup = () => {
    const run = vi.fn();
    const ctx = setup({
      commands: [
        appCommand('app:chord', {
          keybindings: [{ key: 'Mod+K Mod+S', when: NOT_TYPING }],
          run,
        }),
      ],
    });
    // Mod+K у палитры — одиночное: цепочка с тем же началом недостижима, поэтому палитру переназначаем
    ctx.user.stored.value = {
      'app:palette.open': [{ key: 'Mod+P', when: null }],
    };
    stop = ctx.stop;
    return { ...ctx, chord: run };
  };

  it('первое сочетание ждёт второе (preventDefault, ожидание объявлено), второе выполняет команду', () => {
    const ctx = chordSetup();
    const first = press(document.body, ctrl('k'));
    expect(first.defaultPrevented).toBe(true);
    expect(ctx.chord).not.toHaveBeenCalled();
    expect(ctx.dispatcher.pending.value).toHaveLength(1);
    const second = press(document.body, ctrl('s'));
    expect(second.defaultPrevented).toBe(true);
    expect(ctx.chord).toHaveBeenCalledOnce();
    expect(ctx.dispatcher.pending.value).toBeNull();
    expect(ctx.time.count()).toBe(0);
  });

  it('по истечении 1,5 с ожидание сбрасывается, второе сочетание не выполняет команду', () => {
    const ctx = chordSetup();
    press(document.body, ctrl('k'));
    ctx.time.fire();
    expect(ctx.dispatcher.pending.value).toBeNull();
    const late = press(document.body, ctrl('s'));
    expect(ctx.chord).not.toHaveBeenCalled();
    expect(late.defaultPrevented).toBe(false);
  });

  it('Escape сбрасывает ожидание и гасится только пока оно идёт', () => {
    const ctx = chordSetup();
    const idle = press(document.body, { key: 'Escape' });
    expect(idle.defaultPrevented).toBe(false);
    press(document.body, ctrl('k'));
    const cancel = press(document.body, { key: 'Escape' });
    expect(cancel.defaultPrevented).toBe(true);
    expect(ctx.dispatcher.pending.value).toBeNull();
    press(document.body, ctrl('s'));
    expect(ctx.chord).not.toHaveBeenCalled();
  });

  it('клавиша, не продолжающая цепочку, сбрасывает ожидание и ничего не выполняет', () => {
    const ctx = chordSetup();
    press(document.body, ctrl('k'));
    const other = press(document.body, ctrl(','));
    expect(ctx.run).not.toHaveBeenCalled();
    expect(other.defaultPrevented).toBe(false);
    expect(ctx.dispatcher.pending.value).toBeNull();
    // цепочку можно начать заново
    press(document.body, ctrl('k'));
    press(document.body, ctrl('s'));
    expect(ctx.chord).toHaveBeenCalledOnce();
  });

  it('одиночный модификатор не прерывает ожидание', () => {
    const ctx = chordSetup();
    press(document.body, ctrl('k'));
    press(document.body, { key: 'Control', ctrlKey: true });
    expect(ctx.dispatcher.pending.value).not.toBeNull();
    press(document.body, ctrl('s'));
    expect(ctx.chord).toHaveBeenCalledOnce();
  });

  it('недоступная команда цепочки не ждёт вторую клавишу', () => {
    const run = vi.fn();
    const ctx = setup({
      commands: [
        appCommand('app:chord', {
          keybindings: [{ key: 'Mod+K Mod+S' }],
          enabled: false,
          run,
        }),
      ],
      user: { 'app:palette.open': [{ key: 'Mod+P', when: null }] },
    });
    stop = ctx.stop;
    const first = press(document.body, ctrl('k'));
    expect(first.defaultPrevented).toBe(false);
    expect(ctx.dispatcher.pending.value).toBeNull();
  });

  it('одиночная привязка высшего приоритета делает цепочку с тем же началом недостижимой, и карта показывает это пересечением', () => {
    const chord = vi.fn();
    const ctx = setup({
      commands: [
        appCommand('app:chord', {
          keybindings: [{ key: 'Mod+K Mod+S' }],
          run: chord,
        }),
      ],
      user: { 'app:palette.open': [{ key: 'Mod+K', when: null }] },
    });
    stop = ctx.stop;
    expect(ctx.keybindings.conflicts.value.map(({ kind }) => kind)).toEqual([
      'prefix',
    ]);
    press(document.body, ctrl('k'));
    expect(ctx.palette).toHaveBeenCalledOnce();
    expect(ctx.dispatcher.pending.value).toBeNull();
    press(document.body, ctrl('s'));
    expect(chord).not.toHaveBeenCalled();
  });
});
