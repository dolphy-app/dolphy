// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCommandRegistry } from '@/shared/lib/command-registry.ts';
import type { CommandDescriptor } from '@/shared/lib/command-registry.ts';
import { installShortcutDispatcher } from '@/shared/lib/shortcut-dispatcher.ts';

const setup = () => {
  const registry = createCommandRegistry();
  const openPalette = vi.fn();
  const run = vi.fn();
  const register = (override: Partial<CommandDescriptor> = {}) =>
    registry.register({
      key: 'app:settings',
      source: 'app',
      title: 'Settings',
      keybinding: 'Mod+,',
      run,
      ...override,
    });
  register();
  const stop = installShortcutDispatcher(document, { registry, openPalette });
  return { registry, openPalette, run, register, stop };
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

let stop: () => void = () => undefined;
beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  stop();
});

describe('installShortcutDispatcher', () => {
  it('Ctrl/⌘+K opens the palette and prevents the default action', () => {
    const ctx = setup();
    stop = ctx.stop;
    const event = press(document.body, { key: 'k', ctrlKey: true });
    expect(ctx.openPalette).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    press(document.body, { key: 'k', metaKey: true });
    expect(ctx.openPalette).toHaveBeenCalledTimes(2);
  });

  it('Ctrl+K opens the palette even in a text field and over a dialog', () => {
    const ctx = setup();
    stop = ctx.stop;
    document.body.innerHTML =
      '<div class="v-dialog v-overlay--active"><input id="f"></div>';
    press(document.getElementById('f')!, { key: 'k', ctrlKey: true });
    expect(ctx.openPalette).toHaveBeenCalledOnce();
  });

  it('fires the keybinding of an app command and prevents the default only then', () => {
    const ctx = setup();
    stop = ctx.stop;
    const handled = press(document.body, { key: ',', ctrlKey: true });
    expect(ctx.run).toHaveBeenCalledOnce();
    expect(handled.defaultPrevented).toBe(true);
    const ignored = press(document.body, { key: 'j', ctrlKey: true });
    expect(ctx.run).toHaveBeenCalledOnce();
    expect(ignored.defaultPrevented).toBe(false);
  });

  it.each([
    '<input id="f">',
    '<textarea id="f"></textarea>',
    '<select id="f"></select>',
    '<div id="f" contenteditable="true"></div>',
    '<div contenteditable="true"><span id="f">x</span></div>',
  ])('does not fire while typing in %s', (html) => {
    const ctx = setup();
    stop = ctx.stop;
    document.body.innerHTML = html;
    const event = press(document.getElementById('f')!, {
      key: ',',
      ctrlKey: true,
    });
    expect(ctx.run).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it.each([
    '<div class="v-dialog v-overlay--active"></div>',
    '<div class="v-menu v-overlay--active"></div>',
    '<div role="dialog" aria-modal="true"></div>',
  ])('does not fire while a dialog or menu is open: %s', (html) => {
    const ctx = setup();
    stop = ctx.stop;
    document.body.innerHTML = html;
    const event = press(document.body, { key: ',', ctrlKey: true });
    expect(ctx.run).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('a snackbar overlay does not block shortcuts', () => {
    const ctx = setup();
    stop = ctx.stop;
    document.body.innerHTML =
      '<div class="v-snackbar v-overlay--active"></div>';
    press(document.body, { key: ',', ctrlKey: true });
    expect(ctx.run).toHaveBeenCalledOnce();
  });

  it('ignores key repeat and composition', () => {
    const ctx = setup();
    stop = ctx.stop;
    const repeated = press(document.body, {
      key: ',',
      ctrlKey: true,
      repeat: true,
    });
    press(document.body, { key: 'k', ctrlKey: true, repeat: true });
    press(document.body, { key: ',', ctrlKey: true, isComposing: true });
    expect(ctx.run).not.toHaveBeenCalled();
    expect(ctx.openPalette).not.toHaveBeenCalled();
    expect(repeated.defaultPrevented).toBe(false);
  });

  it('skips unavailable commands and keybindings of extension commands', () => {
    const ctx = setup();
    stop = ctx.stop;
    const extensionRun = vi.fn();
    ctx.register({
      key: 'extension:acme:go',
      source: 'extension',
      keybinding: 'Mod+J',
      run: extensionRun,
    });
    ctx.register({
      key: 'app:off',
      keybinding: 'Mod+L',
      enabled: false,
      run: extensionRun,
    });
    press(document.body, { key: 'j', ctrlKey: true });
    press(document.body, { key: 'l', ctrlKey: true });
    expect(extensionRun).not.toHaveBeenCalled();
  });

  it('stops listening after dispose', () => {
    const ctx = setup();
    ctx.stop();
    press(document.body, { key: 'k', ctrlKey: true });
    expect(ctx.openPalette).not.toHaveBeenCalled();
  });
});
