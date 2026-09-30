import { describe, expect, it } from 'vitest';
import { restartExtensionHosts } from '../electron/main/shells/extension-reload.ts';
import { createExtensionsApplyShell } from '../electron/main/shells/extensions-apply.ts';
import type { ExtensionsApplyEvent } from '../electron/main/shells/extensions-apply.ts';

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const setup = () => {
  const calls: string[] = [];
  let handler: ((event: ExtensionsApplyEvent) => Promise<void>) | null = null;
  const timers: (() => void)[] = [];
  const windows = [1, 2].map((id) => ({
    reloadIgnoringCache: () => calls.push(`reload:${id}`),
  }));
  createExtensionsApplyShell({
    ipcMain: {
      handle: (channel, listener) => {
        expect(channel).toBe('extensions:apply');
        handler = listener;
      },
    },
    restartHosts: () => calls.push('restart'),
    windows: () => windows,
    timers: { setTimeout: (callback) => timers.push(callback) },
    logger: silentLogger,
  }).register();
  const frame = {};
  const invoke = (senderFrame: unknown = frame) =>
    handler!({ sender: { mainFrame: frame }, senderFrame });
  return { calls, invoke, flush: () => timers.splice(0).forEach((t) => t()) };
};

describe('restartExtensionHosts', () => {
  it('перезапускает хосты, затем перезагружает каждое окно', () => {
    const calls: string[] = [];
    restartExtensionHosts({
      restartHosts: () => calls.push('restart'),
      windows: () => [{ reloadIgnoringCache: () => calls.push('reload') }],
    });
    expect(calls).toEqual(['restart', 'reload']);
  });
});

describe('extensions apply shell', () => {
  it('отвечает сразу, а перезапуск хостов и перезагрузку окон откладывает', async () => {
    const { calls, invoke, flush } = setup();
    await expect(invoke()).resolves.toBeUndefined();
    expect(calls).toEqual([]);
    flush();
    expect(calls).toEqual(['restart', 'reload:1', 'reload:2']);
  });

  it('игнорирует запрос из вложенного фрейма', async () => {
    const { calls, invoke, flush } = setup();
    await invoke({});
    flush();
    expect(calls).toEqual([]);
  });

  it('каждый запрос даёт свой перезапуск', async () => {
    const { calls, invoke, flush } = setup();
    await invoke();
    await invoke();
    flush();
    expect(calls.filter((call) => call === 'restart')).toHaveLength(2);
  });
});
