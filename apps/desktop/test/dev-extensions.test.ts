import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DEV_DEBOUNCE_MS,
  createDevExtensionsShell,
} from '../electron/main/shells/dev-extensions.ts';

const DIR = '/dev-ext';

const setup = (options: { exists?: boolean } = {}) => {
  const calls: string[] = [];
  const warned: unknown[] = [];
  let emit: (filename: string | null) => void = () => undefined;
  let quit: () => void = () => undefined;
  const watch = vi.fn(
    (_dir: string, listener: (filename: string | null) => void) => {
      emit = listener;
      return { close: () => calls.push('close') };
    },
  );
  const windows = [1, 2].map((id) => ({
    reloadIgnoringCache: () => calls.push(`reload:${id}`),
  }));
  createDevExtensionsShell({
    app: {
      on: (_event, listener) => {
        quit = listener;
      },
    },
    dir: DIR,
    watch,
    timers: { setTimeout, clearTimeout },
    restartHosts: () => calls.push('restart'),
    windows: () => windows,
    exists: () => options.exists ?? true,
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: (fields) => warned.push(fields),
      error: () => undefined,
    },
  }).register();
  return {
    calls,
    warned,
    watch,
    change: (filename: string | null) => emit(filename),
    quit: () => quit(),
  };
};

describe('dev extensions shell', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('серия изменений даёт один перезапуск хостов и одну перезагрузку окон', () => {
    const { calls, watch, change } = setup();
    expect(watch).toHaveBeenCalledWith(DIR, expect.any(Function));
    change('spirula.x/main.mjs');
    vi.advanceTimersByTime(DEFAULT_DEV_DEBOUNCE_MS - 50);
    change('spirula.x/view.mjs'); // сдвигает срабатывание
    vi.advanceTimersByTime(DEFAULT_DEV_DEBOUNCE_MS - 1);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(['restart', 'reload:1', 'reload:2']);
    vi.advanceTimersByTime(10_000);
    expect(calls).toHaveLength(3);
  });

  it('хосты перезапускаются раньше перезагрузки окон', () => {
    const { calls, change } = setup();
    change(null);
    vi.advanceTimersByTime(DEFAULT_DEV_DEBOUNCE_MS);
    expect(calls.indexOf('restart')).toBe(0);
    expect(calls.indexOf('reload:1')).toBeGreaterThan(0);
  });

  it('разделённые паузой серии дают две перезагрузки', () => {
    const { calls, change } = setup();
    change('a/extension.json');
    vi.advanceTimersByTime(DEFAULT_DEV_DEBOUNCE_MS);
    change('a/extension.json');
    vi.advanceTimersByTime(DEFAULT_DEV_DEBOUNCE_MS);
    expect(calls.filter((call) => call === 'restart')).toHaveLength(2);
    expect(calls.filter((call) => call === 'reload:1')).toHaveLength(2);
  });

  it('нет каталога: предупреждение и никакого наблюдения', () => {
    const { warned, watch } = setup({ exists: false });
    expect(warned).toEqual([{ dir: DIR }]);
    expect(watch).not.toHaveBeenCalled();
  });

  it.each([
    '.DS_Store',
    'a/.hidden/main.mjs',
    '.git/index',
    'a/node_modules/dep/index.js',
  ])('игнорирует служебный файл %s', (filename) => {
    const { calls, change } = setup();
    change(filename);
    vi.advanceTimersByTime(DEFAULT_DEV_DEBOUNCE_MS * 2);
    expect(calls).toEqual([]);
  });

  it('выход из приложения закрывает наблюдатель и отменяет ожидающую перезагрузку', () => {
    const { calls, change, quit } = setup();
    change('a/main.mjs');
    quit();
    vi.advanceTimersByTime(DEFAULT_DEV_DEBOUNCE_MS * 2);
    expect(calls).toEqual(['close']);
    change('a/main.mjs'); // события после закрытия не действуют
    vi.advanceTimersByTime(DEFAULT_DEV_DEBOUNCE_MS * 2);
    expect(calls).toEqual(['close']);
  });
});
