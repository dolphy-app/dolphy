// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFrameHost,
  frameUrlOf,
  MAX_ERROR_CHARS,
  MAX_FRAME_HEIGHT,
  parseFrameMessage,
} from '../src/shared/lib/frame-bridge.ts';
import type {
  FrameHandlers,
  FrameInit,
} from '../src/shared/lib/frame-bridge.ts';
import {
  createDomThemeSource,
  readThemeSnapshot,
} from '../src/shared/lib/frame-theme.ts';
import type { ThemeSnapshot } from '../src/shared/lib/frame-theme.ts';

const frameMessage = (extra: Record<string, unknown>) => ({
  dolphyFrame: 1,
  ...extra,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('parseFrameMessage', () => {
  it.each([
    [{ type: 'ready' }],
    [{ type: 'answer-submit' }],
    [{ type: 'done' }],
    [{ type: 'error', message: 'x' }],
  ])('пропускает корректное сообщение %j', (extra) => {
    expect(parseFrameMessage(frameMessage(extra))).toMatchObject(extra);
  });

  it.each([
    ['не объект', 'ready'],
    ['null', null],
    ['без маркера', { type: 'ready' }],
    ['другая версия', { dolphyFrame: 2, type: 'ready' }],
    ['неизвестный тип', frameMessage({ type: 'eval' })],
    ['change без detail', frameMessage({ type: 'answer-change' })],
    [
      'change с нелогичным complete',
      frameMessage({
        type: 'answer-change',
        detail: { value: 1, complete: 1 },
      }),
    ],
    ['size не число', frameMessage({ type: 'size', height: '10' })],
    ['size NaN', frameMessage({ type: 'size', height: Number.NaN })],
    ['size Infinity', frameMessage({ type: 'size', height: Infinity })],
    ['error без текста', frameMessage({ type: 'error', message: 5 })],
  ])('отбрасывает: %s', (_name, data) => {
    expect(parseFrameMessage(data)).toBeNull();
  });

  it('отбрасывает лишние поля detail и сохраняет значение', () => {
    expect(
      parseFrameMessage(
        frameMessage({
          type: 'answer-change',
          detail: { value: [1, 2], complete: true, extra: 'x' },
        }),
      ),
    ).toEqual({
      type: 'answer-change',
      detail: { value: [1, 2], complete: true },
    });
  });

  it('ограничивает высоту 0…4000 и округляет', () => {
    const height = (value: number) =>
      parseFrameMessage(frameMessage({ type: 'size', height: value }));
    expect(height(-50)).toEqual({ type: 'size', height: 0 });
    expect(height(12.6)).toEqual({ type: 'size', height: 13 });
    expect(height(1e9)).toEqual({ type: 'size', height: MAX_FRAME_HEIGHT });
  });

  it('обрезает сообщение об ошибке до 10 000 символов', () => {
    const parsed = parseFrameMessage(
      frameMessage({
        type: 'error',
        message: 'x'.repeat(MAX_ERROR_CHARS + 50),
      }),
    );
    expect(parsed).toMatchObject({ type: 'error' });
    expect((parsed as { message: string }).message).toHaveLength(
      MAX_ERROR_CHARS,
    );
  });
});

describe('frameUrlOf', () => {
  it('строит адрес страницы рамки по адресу модуля расширения', () => {
    expect(frameUrlOf('dolphy-ext://acme.echo/view.mjs')).toBe(
      'dolphy-ext://acme.echo/__dolphy/frame.html',
    );
  });

  it('чужая схема — ошибка', () => {
    expect(() => frameUrlOf('https://example.com/view.mjs')).toThrow();
  });
});

const ANSWER: FrameInit = {
  mode: 'answer',
  rendererUrl: 'dolphy-ext://acme.echo/view.mjs',
  element: 'acme-echo-answer',
  label: 'Ответ',
};

const setup = (
  overrides: { handlers?: FrameHandlers; readyTimeoutMs?: number } = {},
) => {
  const posted: { message: Record<string, unknown>; origin: string }[] = [];
  const contentWindow = {
    postMessage: (message: Record<string, unknown>, origin: string) => {
      posted.push({ message, origin });
    },
  };
  const frame = {
    contentWindow,
    ownerDocument: document,
  } as unknown as HTMLIFrameElement;
  const target = new EventTarget();
  const snapshot: { current: ThemeSnapshot } = {
    current: { variables: { '--v-theme-primary': '1,2,3' }, dark: false },
  };
  const themeListeners = new Set<() => void>();
  const handlers = {
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onSize: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
    ...overrides.handlers,
  };
  const host = createFrameHost({
    frame,
    init: ANSWER,
    props: { view: { options: ['a'] }, disabled: false, verdict: null },
    handlers,
    target,
    theme: {
      read: () => snapshot.current,
      subscribe: (listener) => {
        themeListeners.add(listener);
        return () => themeListeners.delete(listener);
      },
    },
    ...(overrides.readyTimeoutMs === undefined
      ? {}
      : { readyTimeoutMs: overrides.readyTimeoutMs }),
  });
  const receive = (data: unknown, source: unknown = contentWindow) => {
    target.dispatchEvent(Object.assign(new Event('message'), { data, source }));
  };
  const types = () => posted.map(({ message }) => message.type);
  return {
    host,
    posted,
    handlers,
    receive,
    types,
    contentWindow,
    snapshot,
    themeListeners,
    target,
  };
};

describe('createFrameHost', () => {
  it('до ready ничего не шлёт; на ready отправляет init, тему и свойства', () => {
    const { posted, receive, types } = setup();
    expect(posted).toEqual([]);
    receive(frameMessage({ type: 'ready' }));
    expect(types()).toEqual(['init', 'theme', 'props']);
    expect(posted.every(({ origin }) => origin === '*')).toBe(true);
    expect(posted.every(({ message }) => message.dolphy === 1)).toBe(true);
    expect(posted[0]?.message).toMatchObject({
      type: 'init',
      mode: 'answer',
      element: 'acme-echo-answer',
      label: 'Ответ',
    });
    expect(posted[1]?.message).toEqual({
      dolphy: 1,
      type: 'theme',
      variables: { '--v-theme-primary': '1,2,3' },
      dark: false,
    });
    expect(posted[2]?.message).toMatchObject({
      type: 'props',
      view: { options: ['a'] },
      disabled: false,
      verdict: null,
    });
  });

  it('принимает сообщения только от contentWindow своей рамки', () => {
    const { receive, handlers, posted } = setup();
    const foreign = { postMessage: () => undefined };
    receive(frameMessage({ type: 'ready' }), foreign);
    receive(frameMessage({ type: 'answer-submit' }), foreign);
    receive(frameMessage({ type: 'answer-submit' }), null);
    receive(frameMessage({ type: 'answer-submit' }), window);
    expect(posted).toEqual([]);
    expect(handlers.onSubmit).not.toHaveBeenCalled();
  });

  it('отбрасывает сообщения неверной формы', () => {
    const { receive, handlers } = setup();
    receive(frameMessage({ type: 'answer-change', detail: { value: 1 } }));
    receive(frameMessage({ type: 'size', height: 'tall' }));
    receive({ type: 'answer-submit' });
    expect(handlers.onChange).not.toHaveBeenCalled();
    expect(handlers.onSize).not.toHaveBeenCalled();
    expect(handlers.onSubmit).not.toHaveBeenCalled();
  });

  it('передаёт обработчикам ответ, отправку, высоту (с ограничением), done и error', () => {
    const { receive, handlers } = setup();
    receive(
      frameMessage({
        type: 'answer-change',
        detail: { value: 'x', complete: true },
      }),
    );
    receive(frameMessage({ type: 'answer-submit' }));
    receive(frameMessage({ type: 'size', height: 99_999 }));
    receive(frameMessage({ type: 'done' }));
    receive(frameMessage({ type: 'error', message: 'boom' }));
    expect(handlers.onChange).toHaveBeenCalledWith({
      value: 'x',
      complete: true,
    });
    expect(handlers.onSubmit).toHaveBeenCalledOnce();
    expect(handlers.onSize).toHaveBeenCalledWith(MAX_FRAME_HEIGHT);
    expect(handlers.onDone).toHaveBeenCalledOnce();
    expect(handlers.onError).toHaveBeenCalledWith('boom');
  });

  it('update: до ready копится, после ready уходит свойствами без реактивных прокси', () => {
    const { host, receive, posted, types } = setup();
    host.update({ disabled: true });
    expect(posted).toEqual([]);
    receive(frameMessage({ type: 'ready' }));
    expect(posted.at(-1)?.message).toMatchObject({ disabled: true });
    host.update({ verdict: { outcome: 'passed' } });
    expect(types().at(-1)).toBe('props');
    expect(posted.at(-1)?.message).toEqual({
      dolphy: 1,
      type: 'props',
      verdict: { outcome: 'passed' },
    });
  });

  it('смена темы отправляется только после ready', () => {
    const { receive, themeListeners, snapshot, posted } = setup();
    const notify = () => themeListeners.forEach((listener) => listener());
    notify();
    expect(posted).toEqual([]);
    receive(frameMessage({ type: 'ready' }));
    snapshot.current = {
      variables: { '--v-theme-primary': '9,9,9' },
      dark: true,
    };
    notify();
    expect(posted.at(-1)?.message).toEqual({
      dolphy: 1,
      type: 'theme',
      variables: { '--v-theme-primary': '9,9,9' },
      dark: true,
    });
  });

  it('dispose: шлёт dispose, снимает слушателей и больше не принимает сообщений', () => {
    const { host, receive, posted, handlers, themeListeners } = setup();
    receive(frameMessage({ type: 'ready' }));
    host.dispose();
    host.dispose();
    expect(
      posted.filter(({ message }) => message.type === 'dispose'),
    ).toHaveLength(1);
    expect(themeListeners.size).toBe(0);
    receive(frameMessage({ type: 'answer-submit' }));
    expect(handlers.onSubmit).not.toHaveBeenCalled();
  });

  it('рамка не сказала ready вовремя — onError; после ready — нет', () => {
    vi.useFakeTimers();
    const silent = setup({ readyTimeoutMs: 1000 });
    vi.advanceTimersByTime(1000);
    expect(silent.handlers.onError).toHaveBeenCalledWith('frame did not start');

    const alive = setup({ readyTimeoutMs: 1000 });
    alive.receive(frameMessage({ type: 'ready' }));
    vi.advanceTimersByTime(5000);
    expect(alive.handlers.onError).not.toHaveBeenCalled();
  });
});

describe('тема приложения', () => {
  const mountApp = (css: string) => {
    document.head.innerHTML = '';
    const style = document.createElement('style');
    style.id = 'vuetify-theme-stylesheet';
    style.textContent = css;
    document.head.append(style);
    document.body.innerHTML = '<div class="v-application"></div>';
    return document.querySelector('.v-application') as HTMLElement;
  };

  it('читает переменные, объявленные в таблице стилей темы Vuetify, и цветовую схему', () => {
    const root = mountApp('.v-theme--x { --v-theme-primary: 1,2,3; }');
    root.style.setProperty('--v-theme-primary', '1,2,3');
    root.style.setProperty('--other', 'y');
    const light = readThemeSnapshot(document);
    expect(light.variables['--v-theme-primary']).toBe('1,2,3');
    expect(light.variables['--other']).toBeUndefined();
    expect(light.dark).toBe(false);
    root.style.setProperty('color-scheme', 'dark');
    expect(readThemeSnapshot(document).dark).toBe(true);
  });

  it('уведомляет о смене класса темы на корне приложения', async () => {
    const root = mountApp('');
    const listener = vi.fn();
    const stop = createDomThemeSource(document).subscribe(listener);
    root.className = 'v-application v-theme--dark';
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());
    stop();
    listener.mockClear();
    root.className = 'v-application v-theme--light';
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
  });
});
