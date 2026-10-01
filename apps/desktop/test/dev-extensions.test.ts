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
  createDevExtensionsShell({
    app: {
      on: (_event, listener) => {
        quit = listener;
      },
    },
    dir: DIR,
    watch,
    timers: { setTimeout, clearTimeout },
    reloadExtensions: () => calls.push('reload'),
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

  it('серия изменений даёт один запрос на применение', () => {
    const { calls, watch, change } = setup();
    expect(watch).toHaveBeenCalledWith(DIR, expect.any(Function));
    change('dolphy.x/main.mjs');
    vi.advanceTimersByTime(DEFAULT_DEV_DEBOUNCE_MS - 50);
    change('dolphy.x/view.mjs'); // сдвигает срабатывание
    vi.advanceTimersByTime(DEFAULT_DEV_DEBOUNCE_MS - 1);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(['reload']);
    vi.advanceTimersByTime(10_000);
    expect(calls).toEqual(['reload']);
  });

  it('разделённые паузой серии дают два запроса', () => {
    const { calls, change } = setup();
    change('a/extension.json');
    vi.advanceTimersByTime(DEFAULT_DEV_DEBOUNCE_MS);
    change('a/extension.json');
    vi.advanceTimersByTime(DEFAULT_DEV_DEBOUNCE_MS);
    expect(calls).toEqual(['reload', 'reload']);
  });

  it('событие без имени файла тоже считается правкой', () => {
    const { calls, change } = setup();
    change(null);
    vi.advanceTimersByTime(DEFAULT_DEV_DEBOUNCE_MS);
    expect(calls).toEqual(['reload']);
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

  it('выход из приложения закрывает наблюдатель и отменяет ожидающий запрос', () => {
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
