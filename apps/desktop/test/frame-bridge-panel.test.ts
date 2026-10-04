// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFrameHost,
  MAX_ERROR_CHARS,
  MAX_PANEL_ARGS_CHARS,
  PANEL_CALLS_IN_FLIGHT,
  PANEL_CALLS_PER_SECOND,
  parseFrameMessage,
} from '../src/shared/lib/frame-bridge.ts';
import type {
  FrameInit,
  PanelBinding,
} from '../src/shared/lib/frame-bridge.ts';

const frameMessage = (extra: Record<string, unknown>) => ({
  dolphyFrame: 1,
  ...extra,
});

const call = (extra: Record<string, unknown> = {}) =>
  frameMessage({
    type: 'panel-call',
    callId: 'c1',
    command: 'acme.panel.ping',
    args: { n: 1 },
    ...extra,
  });

afterEach(() => {
  vi.useRealTimers();
});

describe('parseFrameMessage: режим panel', () => {
  it('пропускает вызов команды и сочетание Mod+K', () => {
    expect(parseFrameMessage(call())).toEqual({
      type: 'panel-call',
      callId: 'c1',
      command: 'acme.panel.ping',
      args: { n: 1 },
    });
    expect(parseFrameMessage(call({ args: undefined, callId: 'c2' }))).toEqual({
      type: 'panel-call',
      callId: 'c2',
      command: 'acme.panel.ping',
      args: undefined,
    });
    expect(
      parseFrameMessage(frameMessage({ type: 'shortcut', key: 'mod+k' })),
    ).toEqual({ type: 'shortcut', key: 'mod+k' });
  });

  it('поле extensionId из сообщения не читается и не попадает в результат', () => {
    const parsed = parseFrameMessage(call({ extensionId: 'evil.other' }));
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty('extensionId');
    expect(JSON.stringify(parsed)).not.toContain('evil.other');
  });

  it.each([
    ['callId не строка', call({ callId: 5 })],
    ['пустой callId', call({ callId: '' })],
    ['callId длиннее 64', call({ callId: 'x'.repeat(65) })],
    ['command не строка', call({ command: { id: 'x' } })],
    ['пустая команда', call({ command: '' })],
    ['команда длиннее 128', call({ command: 'c'.repeat(129) })],
    [
      'аргументы длиннее 200 000 знаков',
      call({ args: 'a'.repeat(MAX_PANEL_ARGS_CHARS) }),
    ],
    [
      'аргументы с циклом',
      (() => {
        const loop: Record<string, unknown> = {};
        loop['self'] = loop;
        return call({ args: loop });
      })(),
    ],
    [
      'shortcut с другой клавишей',
      frameMessage({ type: 'shortcut', key: 'mod+j' }),
    ],
    ['shortcut без клавиши', frameMessage({ type: 'shortcut' })],
  ])('отбрасывает: %s', (_name, data) => {
    expect(parseFrameMessage(data)).toBeNull();
  });

  it('аргументы приводятся к JSON: undefined в полях и функции отбрасываются', () => {
    const parsed = parseFrameMessage(
      call({ args: { a: 1, skipped: undefined, fn: () => 1 } }),
    );
    expect(parsed).toMatchObject({ args: { a: 1 } });
    expect((parsed as { args: object }).args).toEqual({ a: 1 });
  });
});

const PANEL: FrameInit = {
  mode: 'panel',
  rendererUrl: 'dolphy-ext://acme.panel/panel.mjs',
  panelId: 'acme.panel.main',
  props: { from: 'open' },
};

const setup = (
  options: {
    commands?: string[];
    invoke?: PanelBinding['invoke'];
    init?: FrameInit;
    withBinding?: boolean;
    context?: { courseId: string | null };
  } = {},
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
  const invoke = vi.fn<PanelBinding['invoke']>(
    options.invoke ?? (async () => 'pong'),
  );
  const onShortcut = vi.fn();
  const onError = vi.fn();
  const onSize = vi.fn();
  const host = createFrameHost({
    frame,
    init: options.init ?? PANEL,
    ...(options.context === undefined ? {} : { context: options.context }),
    ...(options.withBinding === false
      ? {}
      : {
          panel: {
            extensionId: 'acme.panel',
            commands: new Set(
              options.commands ?? ['acme.panel.ping', 'acme.panel.hidden'],
            ),
            invoke,
          },
        }),
    handlers: { onShortcut, onError, onSize },
    target,
    theme: {
      read: () => ({ variables: {}, dark: false }),
      subscribe: () => () => undefined,
    },
  });
  const receive = (data: unknown, source: unknown = contentWindow) => {
    target.dispatchEvent(Object.assign(new Event('message'), { data, source }));
  };
  const results = () =>
    posted
      .map(({ message }) => message)
      .filter((message) => message['type'] === 'panel-result');
  const flush = async () => {
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
  };
  return {
    host,
    posted,
    receive,
    invoke,
    onShortcut,
    onError,
    onSize,
    results,
    flush,
    contentWindow,
  };
};

describe('createFrameHost: режим panel', () => {
  it('на ready отправляет init со свойствами и тему, но не свойства ответа', () => {
    const { receive, posted } = setup();
    receive(frameMessage({ type: 'ready' }));
    expect(posted.map(({ message }) => message['type'])).toEqual([
      'init',
      'theme',
    ]);
    expect(posted[0]?.message).toEqual({
      dolphy: 1,
      type: 'init',
      mode: 'panel',
      rendererUrl: 'dolphy-ext://acme.panel/panel.mjs',
      panelId: 'acme.panel.main',
      props: { from: 'open' },
      context: { courseId: null },
    });
  });

  it('updatePanelProps: до ready копится в init, после ready уходит panel-props', () => {
    const { host, receive, posted } = setup();
    host.updatePanelProps({ from: 'later' });
    receive(frameMessage({ type: 'ready' }));
    expect(posted[0]?.message).toMatchObject({ props: { from: 'later' } });
    host.updatePanelProps({ n: 2 });
    expect(posted.at(-1)?.message).toEqual({
      dolphy: 1,
      type: 'panel-props',
      props: { n: 2 },
    });
  });

  it('вызов объявленной команды идёт от расширения, привязанного приложением', async () => {
    const { receive, invoke, results, flush } = setup();
    receive(frameMessage({ type: 'ready' }));
    receive(call({ extensionId: 'evil.other' }));
    await flush();
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      'acme.panel',
      'acme.panel.ping',
      { n: 1 },
    );
    expect(results()).toEqual([
      {
        dolphy: 1,
        type: 'panel-result',
        callId: 'c1',
        ok: true,
        value: 'pong',
      },
    ]);
  });

  it('команда вне допустимого набора (в том числе чужого расширения) отклоняется без вызова', async () => {
    const { receive, invoke, results, flush } = setup();
    receive(frameMessage({ type: 'ready' }));
    receive(call({ command: 'evil.other.steal' }));
    await flush();
    expect(invoke).not.toHaveBeenCalled();
    expect(results()).toEqual([
      {
        dolphy: 1,
        type: 'panel-result',
        callId: 'c1',
        ok: false,
        error: { message: 'unknown command: evil.other.steal' },
      },
    ]);
  });

  it('команда с palette:false доступна панели', async () => {
    const { receive, invoke, flush } = setup();
    receive(frameMessage({ type: 'ready' }));
    receive(call({ command: 'acme.panel.hidden' }));
    await flush();
    expect(invoke).toHaveBeenCalledWith('acme.panel', 'acme.panel.hidden', {
      n: 1,
    });
  });

  it('отказ вызова уходит рамке текстом, обрезанным до 10 000 знаков', async () => {
    const { receive, results, flush } = setup({
      invoke: async () => {
        throw new Error('x'.repeat(MAX_ERROR_CHARS + 10));
      },
    });
    receive(frameMessage({ type: 'ready' }));
    receive(call());
    await flush();
    const [result] = results();
    expect(result).toMatchObject({ ok: false, callId: 'c1' });
    expect((result?.['error'] as { message: string }).message).toHaveLength(
      MAX_ERROR_CHARS,
    );
  });

  it('не больше 4 вызовов одновременно: пятый отклоняется, после ответа место освобождается', async () => {
    const pending: ((value: string) => void)[] = [];
    const { receive, invoke, results, flush } = setup({
      invoke: () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    });
    receive(frameMessage({ type: 'ready' }));
    for (let index = 0; index < PANEL_CALLS_IN_FLIGHT; index += 1) {
      receive(call({ callId: `c${index}` }));
    }
    receive(call({ callId: 'over' }));
    await flush();
    expect(invoke).toHaveBeenCalledTimes(PANEL_CALLS_IN_FLIGHT);
    expect(results()).toEqual([
      expect.objectContaining({
        callId: 'over',
        ok: false,
        error: { message: 'too many calls in flight' },
      }),
    ]);
    pending[0]?.('done');
    await flush();
    receive(call({ callId: 'next' }));
    await flush();
    expect(invoke).toHaveBeenCalledTimes(PANEL_CALLS_IN_FLIGHT + 1);
  });

  it('не больше 20 вызовов в секунду; окно скользит', async () => {
    vi.useFakeTimers();
    const { receive, invoke, results } = setup();
    receive(frameMessage({ type: 'ready' }));
    for (let index = 0; index < PANEL_CALLS_PER_SECOND; index += 1) {
      receive(call({ callId: `c${index}` }));
      await vi.advanceTimersByTimeAsync(0);
    }
    receive(call({ callId: 'burst' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke).toHaveBeenCalledTimes(PANEL_CALLS_PER_SECOND);
    expect(results().at(-1)).toMatchObject({
      callId: 'burst',
      ok: false,
      error: { message: 'too many calls per second' },
    });
    await vi.advanceTimersByTimeAsync(1000);
    receive(call({ callId: 'later' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke).toHaveBeenCalledTimes(PANEL_CALLS_PER_SECOND + 1);
  });

  it('повтор идентификатора вызова, который ещё выполняется, игнорируется', async () => {
    const { receive, invoke, results, flush } = setup({
      invoke: () => new Promise(() => {}),
    });
    receive(frameMessage({ type: 'ready' }));
    receive(call({ callId: 'same' }));
    receive(call({ callId: 'same' }));
    await flush();
    expect(invoke).toHaveBeenCalledOnce();
    expect(results()).toEqual([]);
  });

  it('после dispose ответ не отправляется и новые вызовы не принимаются', async () => {
    let finish: (value: string) => void = () => undefined;
    const { host, receive, invoke, results, flush } = setup({
      invoke: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    receive(frameMessage({ type: 'ready' }));
    receive(call());
    host.dispose();
    finish('late');
    await flush();
    receive(call({ callId: 'c2' }));
    await flush();
    expect(invoke).toHaveBeenCalledOnce();
    expect(results()).toEqual([]);
  });

  it('вызов до ready игнорируется', async () => {
    const { receive, invoke, flush } = setup();
    receive(call());
    await flush();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('сообщения принимаются только от своей рамки', async () => {
    const { receive, invoke, onShortcut, flush } = setup();
    receive(frameMessage({ type: 'ready' }));
    const foreign = { postMessage: () => undefined };
    receive(call(), foreign);
    receive(frameMessage({ type: 'shortcut', key: 'mod+k' }), foreign);
    receive(frameMessage({ type: 'shortcut', key: 'mod+k' }), window);
    await flush();
    expect(invoke).not.toHaveBeenCalled();
    expect(onShortcut).not.toHaveBeenCalled();
  });

  it('Mod+K из своей рамки доходит до приложения', () => {
    const { receive, onShortcut } = setup();
    receive(frameMessage({ type: 'ready' }));
    receive(frameMessage({ type: 'shortcut', key: 'mod+k' }));
    expect(onShortcut).toHaveBeenCalledOnce();
  });

  it('рамка без привязки панели (ответ, markdown) не вызывает команды и не шлёт сочетание', async () => {
    const { receive, invoke, onShortcut, flush } = setup({
      init: {
        mode: 'markdown',
        rendererUrl: 'dolphy-ext://acme.panel/md.mjs',
        language: 'x',
        source: 'y',
      },
      withBinding: false,
    });
    receive(frameMessage({ type: 'ready' }));
    receive(call());
    receive(frameMessage({ type: 'shortcut', key: 'mod+k' }));
    await flush();
    expect(invoke).not.toHaveBeenCalled();
    expect(onShortcut).not.toHaveBeenCalled();
  });
});

const WIDGET: FrameInit = {
  mode: 'widget',
  rendererUrl: 'dolphy-ext://acme.panel/widget.mjs',
  widgetId: 'acme.panel.card',
};

const contextMessages = (posted: { message: Record<string, unknown> }[]) =>
  posted
    .map(({ message }) => message)
    .filter((message) => message['type'] === 'context');

describe('createFrameHost: режим widget', () => {
  it('на ready отправляет init с окружением и тему, без свойств; размер идёт обработчику', () => {
    const { receive, posted, onSize } = setup({
      init: WIDGET,
      context: { courseId: 'c1' },
    });
    receive(frameMessage({ type: 'ready' }));
    expect(posted.map(({ message }) => message['type'])).toEqual([
      'init',
      'theme',
    ]);
    expect(posted[0]?.message).toEqual({
      dolphy: 1,
      type: 'init',
      mode: 'widget',
      rendererUrl: 'dolphy-ext://acme.panel/widget.mjs',
      widgetId: 'acme.panel.card',
      context: { courseId: 'c1' },
    });
    receive(frameMessage({ type: 'size', height: 123.4 }));
    expect(onSize).toHaveBeenCalledExactlyOnceWith(123);
  });

  it('вызов команды идёт от расширения, привязанного приложением; чужая команда отклоняется', async () => {
    const { receive, invoke, results, flush } = setup({ init: WIDGET });
    receive(frameMessage({ type: 'ready' }));
    receive(call({ extensionId: 'evil.other' }));
    receive(call({ callId: 'c2', command: 'evil.other.steal' }));
    await flush();
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      'acme.panel',
      'acme.panel.ping',
      { n: 1 },
    );
    expect(results()).toEqual([
      expect.objectContaining({ callId: 'c2', ok: false }),
      expect.objectContaining({ callId: 'c1', ok: true, value: 'pong' }),
    ]);
  });

  it('без привязки вызовы и сочетание игнорируются', async () => {
    const { receive, invoke, results, onShortcut, flush } = setup({
      init: WIDGET,
      withBinding: false,
    });
    receive(frameMessage({ type: 'ready' }));
    receive(call());
    receive(frameMessage({ type: 'shortcut', key: 'mod+k' }));
    await flush();
    expect(invoke).not.toHaveBeenCalled();
    expect(results()).toEqual([]);
    expect(onShortcut).not.toHaveBeenCalled();
  });

  it('Ctrl/⌘+K из рамки виджета доходит до приложения', () => {
    const { receive, onShortcut } = setup({ init: WIDGET });
    receive(frameMessage({ type: 'ready' }));
    receive(frameMessage({ type: 'shortcut', key: 'mod+k' }));
    expect(onShortcut).toHaveBeenCalledOnce();
  });

  it('сообщения чужого окна не принимаются', async () => {
    const { receive, invoke, onSize, flush } = setup({ init: WIDGET });
    receive(frameMessage({ type: 'ready' }));
    receive(call(), {});
    receive(frameMessage({ type: 'size', height: 99 }), {});
    await flush();
    expect(invoke).not.toHaveBeenCalled();
    expect(onSize).not.toHaveBeenCalled();
  });
});

describe('createFrameHost: окружение панели и виджета', () => {
  it.each([
    ['panel', undefined],
    ['widget', WIDGET],
  ] as const)(
    '%s: updateContext до ready копится в init, после ready уходит сообщением context; повтор значения не шлётся',
    (_mode, init) => {
      const { host, receive, posted } = setup(init ? { init } : {});
      host.updateContext({ courseId: 'c1' });
      receive(frameMessage({ type: 'ready' }));
      expect(posted[0]?.message).toMatchObject({ context: { courseId: 'c1' } });
      expect(contextMessages(posted)).toEqual([]);

      host.updateContext({ courseId: 'c1' });
      expect(contextMessages(posted)).toEqual([]);
      host.updateContext({ courseId: null });
      expect(contextMessages(posted)).toEqual([
        { dolphy: 1, type: 'context', context: { courseId: null } },
      ]);
    },
  );

  it('рамка не получает окружение, пока не готова', () => {
    const { host, posted } = setup({ init: WIDGET });
    host.updateContext({ courseId: 'c1' });
    expect(posted).toEqual([]);
  });

  it('режим без окружения (элемент ответа) его не получает', () => {
    const { host, receive, posted } = setup({
      init: {
        mode: 'answer',
        rendererUrl: 'dolphy-ext://acme.panel/view.mjs',
        element: 'x-answer',
        label: 'a',
      },
    });
    receive(frameMessage({ type: 'ready' }));
    host.updateContext({ courseId: 'c1' });
    expect(contextMessages(posted)).toEqual([]);
  });
});
