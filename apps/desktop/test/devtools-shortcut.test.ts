import { describe, expect, it, vi } from 'vitest';
import {
  createDevToolsShortcutShell,
  isDevToolsShortcut,
} from '../electron/main/shells/devtools-shortcut.ts';
import type {
  DevToolsWebContentsLike,
  ShortcutInput,
} from '../electron/main/shells/devtools-shortcut.ts';

const key = (
  code: string,
  mods: Partial<ShortcutInput> = {},
): ShortcutInput => ({
  type: 'keyDown',
  code,
  isAutoRepeat: false,
  control: false,
  shift: false,
  alt: false,
  meta: false,
  ...mods,
});

const setup = (options: { dir?: string; platform?: string } = {}) => {
  let created: (
    event: unknown,
    window: { webContents: DevToolsWebContentsLike },
  ) => void = () => undefined;
  const subscribed = vi.fn();
  createDevToolsShortcutShell({
    app: {
      on: (_event, listener) => {
        subscribed();
        created = listener;
      },
    },
    ...(options.dir === undefined ? {} : { devExtensionsDir: options.dir }),
    platform: options.platform ?? 'darwin',
  }).register();
  let listener: Parameters<DevToolsWebContentsLike['on']>[1] = () => undefined;
  const toggleDevTools = vi.fn();
  const webContents: DevToolsWebContentsLike = {
    on: (_event, next) => {
      listener = next;
    },
    toggleDevTools,
  };
  if (subscribed.mock.calls.length > 0) created({}, { webContents });
  return {
    toggleDevTools,
    subscribed,
    press: (input: ShortcutInput) => {
      const preventDefault = vi.fn();
      listener({ preventDefault }, input);
      return preventDefault;
    },
  };
};

describe('devtools shortcut', () => {
  it('toggles DevTools on F12, Cmd+Alt+I (macOS) and Ctrl+Shift+I and swallows the key', () => {
    const app = setup({ dir: '/dev-ext', platform: 'darwin' });
    for (const input of [
      key('F12'),
      key('KeyI', { meta: true, alt: true }),
      key('KeyI', { control: true, shift: true }),
    ]) {
      const prevented = app.press(input);
      expect(prevented).toHaveBeenCalledTimes(1);
    }
    expect(app.toggleDevTools).toHaveBeenCalledTimes(3);
  });

  it('with the developer directory unset nothing subscribes to windows', () => {
    const app = setup({ platform: 'darwin' });
    expect(app.subscribed).not.toHaveBeenCalled();
    expect(app.toggleDevTools).not.toHaveBeenCalled();
  });

  it('other keys and combinations leave the page alone', () => {
    const app = setup({ dir: '/dev-ext', platform: 'win32' });
    for (const input of [
      key('KeyI'),
      key('KeyI', { control: true }),
      key('KeyI', { shift: true }),
      key('KeyI', { control: true, shift: true, alt: true }),
      key('KeyJ', { control: true, shift: true }),
      key('F12', { shift: true }),
      key('F11'),
      key('F12', { type: 'keyUp' }),
      key('F12', { isAutoRepeat: true }),
    ]) {
      expect(app.press(input)).not.toHaveBeenCalled();
    }
    expect(app.toggleDevTools).not.toHaveBeenCalled();
  });

  it('Cmd+Alt+I is a macOS combination only', () => {
    expect(
      isDevToolsShortcut(key('KeyI', { meta: true, alt: true }), 'darwin'),
    ).toBe(true);
    expect(
      isDevToolsShortcut(key('KeyI', { meta: true, alt: true }), 'linux'),
    ).toBe(false);
    expect(
      isDevToolsShortcut(key('KeyI', { control: true, shift: true }), 'linux'),
    ).toBe(true);
  });
});
