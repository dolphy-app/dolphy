// @vitest-environment happy-dom
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import runtimeSource from '../electron/main/shells/frame-runtime.js?raw';

type LoadModule = (url: string) => Promise<unknown>;
type Runtime = (win: unknown, loadModule: LoadModule) => void;

const runtime = new Function(
  `${runtimeSource}\nreturn dolphyFrameRuntime;`,
)() as Runtime;

const URL_PREFIX = 'dolphy-ext://acme.echo';

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  disconnected = false;
  constructor(private readonly callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }
  observing = false;
  observe() {
    this.observing = true;
  }
  disconnect() {
    this.disconnected = true;
  }
  fire() {
    this.callback();
  }
}

const setup = (loadModule: LoadModule = async () => ({})) => {
  FakeResizeObserver.instances = [];
  const happy = new Window();
  const document = happy.document;
  const posted: Record<string, unknown>[] = [];
  const parent = {
    postMessage: (message: Record<string, unknown>, origin: string) => {
      expect(origin).toBe('*');
      posted.push(message);
    },
  };
  const height = { value: 120 };
  document.body.getBoundingClientRect = () =>
    ({ height: height.value }) as never;
  runtime(
    {
      document,
      parent,
      location: new URL(`${URL_PREFIX}/__dolphy/frame.html`),
      addEventListener: happy.addEventListener.bind(happy),
      customElements: happy.customElements,
      ResizeObserver: FakeResizeObserver,
    },
    loadModule,
  );
  const send = (message: unknown, source: unknown = parent) => {
    happy.dispatchEvent(
      Object.assign(new happy.Event('message'), { data: message, source }),
    );
  };
  const define = (tag: string, configure?: (el: HTMLElement) => void) => {
    class Answer extends happy.HTMLElement {
      view: unknown;
      value: unknown;
      disabled = false;
      verdict: unknown = null;
      constructor() {
        super();
        configure?.(this as unknown as HTMLElement);
      }
    }
    happy.customElements.define(tag, Answer);
  };
  // цепочка промисов старта рантайма короткая: хватает нескольких микрозадач
  const flush = async () => {
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
  };
  return { happy, document, posted, parent, send, define, flush, height };
};

const answerInit = (element = 'x-answer') => ({
  dolphy: 1,
  type: 'init',
  mode: 'answer',
  rendererUrl: `${URL_PREFIX}/view.mjs`,
  element,
  label: 'Ответ',
});

const types = (posted: Record<string, unknown>[]) =>
  posted.map((message) => message.type);

afterEach(() => {
  vi.useRealTimers();
});

describe('рантайм рамки', () => {
  it('сообщает ready и помечает сообщения маркером dolphyFrame', () => {
    const { posted } = setup();
    expect(posted).toEqual([{ dolphyFrame: 1, type: 'ready' }]);
  });

  it('answer: грузит модуль, создаёт элемент с aria-label и выставляет свойства', async () => {
    const { send, define, flush, document, posted } = setup(async (url) => {
      expect(url).toBe(`${URL_PREFIX}/view.mjs`);
      return {};
    });
    define('x-answer');
    send(answerInit());
    await flush();
    const element = document.querySelector('x-answer') as unknown as {
      getAttribute(name: string): string | null;
      view: unknown;
      disabled: boolean;
      verdict: unknown;
    };
    expect(element.getAttribute('aria-label')).toBe('Ответ');
    send({
      dolphy: 1,
      type: 'props',
      view: { options: ['a'] },
      disabled: true,
      verdict: { outcome: 'failed' },
    });
    expect(element.view).toEqual({ options: ['a'] });
    expect(element.disabled).toBe(true);
    expect(element.verdict).toEqual({ outcome: 'failed' });
    expect(types(posted)).toContain('size');
  });

  it('свойства, присланные до создания элемента, применяются при создании', async () => {
    const { send, define, flush, document } = setup();
    define('x-answer');
    send({ dolphy: 1, type: 'props', view: 'early', disabled: true });
    send(answerInit());
    await flush();
    const element = document.querySelector('x-answer') as unknown as {
      view: unknown;
      disabled: boolean;
    };
    expect(element.view).toBe('early');
    expect(element.disabled).toBe(true);
  });

  it('пересылает события change и submit элемента', async () => {
    const { send, define, flush, document, posted } = setup();
    define('x-answer');
    send(answerInit());
    await flush();
    const element = document.querySelector(
      'x-answer',
    ) as unknown as HTMLElement;
    element.dispatchEvent(
      new CustomEvent('dolphy-answer-change', {
        detail: { value: 'select 1', complete: true, extra: 1 },
      }),
    );
    element.dispatchEvent(new CustomEvent('dolphy-answer-submit'));
    expect(posted).toContainEqual({
      dolphyFrame: 1,
      type: 'answer-change',
      detail: { value: 'select 1', complete: true },
    });
    expect(types(posted)).toContain('answer-submit');
  });

  it('игнорирует сообщения не от родителя и без маркера', async () => {
    const { send, define, flush, document, posted } = setup();
    define('x-answer');
    send(answerInit(), { postMessage: () => undefined });
    send({ ...answerInit(), dolphy: 2 });
    send('init');
    send(null);
    await flush();
    expect(document.querySelector('x-answer')).toBeNull();
    expect(types(posted)).toEqual(['ready']);
  });

  it('повторный init игнорируется', async () => {
    const load = vi.fn(async () => ({}));
    const { send, define, flush } = setup(load);
    define('x-answer');
    send(answerInit());
    send(answerInit());
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('модуль вне своего расширения и неверное имя элемента — error', async () => {
    const load = vi.fn(async () => ({}));
    const { send, flush, posted } = setup(load);
    send({ ...answerInit(), rendererUrl: 'dolphy-ext://other.ext/view.mjs' });
    await flush();
    expect(load).not.toHaveBeenCalled();
    expect(posted.at(-1)).toMatchObject({
      type: 'error',
      message: 'renderer is outside the extension',
    });

    const second = setup(load);
    second.send(answerInit('NotATag'));
    await second.flush();
    expect(second.posted.at(-1)).toMatchObject({
      type: 'error',
      message: 'invalid element name',
    });
  });

  it('сбой загрузки модуля — error с сообщением', async () => {
    const { send, flush, posted } = setup(() =>
      Promise.reject(new Error('import failed')),
    );
    send(answerInit());
    await flush();
    expect(posted.at(-1)).toEqual({
      dolphyFrame: 1,
      type: 'error',
      message: 'import failed',
    });
  });

  it('элемент не определён за 5 с — error', async () => {
    vi.useFakeTimers();
    const { send, posted } = setup();
    send(answerInit('x-never'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(posted.at(-1)).toMatchObject({
      type: 'error',
      message: 'extension did not define <x-never>',
    });
  });

  it('Ctrl/⌘+Enter отправляет ответ один раз, даже если элемент тоже его отправляет', async () => {
    vi.useFakeTimers();
    const { send, define, document, posted, happy } = setup();
    define('x-answer', (el) =>
      el.addEventListener('keydown', () =>
        el.dispatchEvent(new CustomEvent('dolphy-answer-submit')),
      ),
    );
    send(answerInit());
    await vi.advanceTimersByTimeAsync(0);
    const element = document.querySelector(
      'x-answer',
    ) as unknown as HTMLElement;
    const press = (init: { ctrlKey?: boolean; metaKey?: boolean }) =>
      element.dispatchEvent(
        new happy.KeyboardEvent('keydown', {
          bubbles: true,
          key: 'Enter',
          ...init,
        }) as never,
      );
    press({ ctrlKey: true });
    expect(posted.filter((m) => m.type === 'answer-submit')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    press({ metaKey: true });
    expect(posted.filter((m) => m.type === 'answer-submit')).toHaveLength(2);
  });

  it('Enter без модификатора ничего не отправляет', async () => {
    const { send, define, flush, document, posted, happy } = setup();
    define('x-answer');
    send(answerInit());
    await flush();
    document.querySelector('x-answer')?.dispatchEvent(
      new happy.KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
      }) as never,
    );
    expect(types(posted)).not.toContain('answer-submit');
  });

  it('тема: выставляет допустимые переменные, снимает прежние, цветовая схема', () => {
    const { send, document } = setup();
    const style = document.documentElement.style;
    send({
      dolphy: 1,
      type: 'theme',
      variables: {
        '--v-theme-primary': '1,2,3',
        '--v-border-opacity': '0.12',
        '--evil': 'x',
        '--v-theme-long': 'x'.repeat(201),
        '--v-theme-number': 5,
      },
      dark: true,
    });
    expect(style.getPropertyValue('--v-theme-primary')).toBe('1,2,3');
    expect(style.getPropertyValue('--v-border-opacity')).toBe('0.12');
    expect(style.getPropertyValue('--evil')).toBe('');
    expect(style.getPropertyValue('--v-theme-long')).toBe('');
    expect(style.getPropertyValue('--v-theme-number')).toBe('');
    expect(style.getPropertyValue('color-scheme')).toBe('dark');

    send({
      dolphy: 1,
      type: 'theme',
      variables: { '--v-theme-primary': '9,9,9' },
      dark: false,
    });
    expect(style.getPropertyValue('--v-theme-primary')).toBe('9,9,9');
    expect(style.getPropertyValue('--v-border-opacity')).toBe('');
    expect(style.getPropertyValue('color-scheme')).toBe('light');
  });

  it('тема: язык интерфейса попадает в <html lang>, чужое значение игнорируется', () => {
    const { send, document } = setup();
    const root = document.documentElement;
    send({ dolphy: 1, type: 'theme', variables: {}, dark: false, lang: 'en' });
    expect(root.lang).toBe('en');
    send({
      dolphy: 1,
      type: 'theme',
      variables: {},
      dark: false,
      lang: 'ru-RU',
    });
    expect(root.lang).toBe('ru-RU');
    for (const lang of ['', '"><script>', 'x'.repeat(40), 5, null]) {
      send({ dolphy: 1, type: 'theme', variables: {}, dark: false, lang });
      expect(root.lang, String(lang)).toBe('ru-RU');
    }
  });

  it('высота: сообщает при изменении, не повторяет прежнее значение', async () => {
    const { send, define, flush, posted, height } = setup();
    define('x-answer');
    send(answerInit());
    await flush();
    const observer = FakeResizeObserver.instances[0];
    observer?.fire();
    height.value = 400;
    observer?.fire();
    observer?.fire();
    expect(
      posted.filter((m) => m.type === 'size').map((m) => m.height),
    ).toEqual([120, 400]);
  });

  it('markdown: вызывает render(source, container, { language, signal }) и сообщает done', async () => {
    const render = vi.fn((source: string, container: HTMLElement) => {
      container.textContent = `rendered ${source}`;
    });
    const { send, flush, posted, document } = setup(async () => ({
      default: { render },
    }));
    send({
      dolphy: 1,
      type: 'init',
      mode: 'markdown',
      rendererUrl: `${URL_PREFIX}/markdown.mjs`,
      language: 'math',
      source: 'E=mc^2',
    });
    await flush();
    expect(render).toHaveBeenCalledWith(
      'E=mc^2',
      expect.anything(),
      expect.objectContaining({ language: 'math' }),
    );
    expect(document.body.textContent).toBe('rendered E=mc^2');
    expect(types(posted)).toEqual(['ready', 'size', 'done']);
  });

  it('markdown: исключение рендерера и модуль без render — error', async () => {
    const boom = setup(async () => ({
      default: {
        render: () => {
          throw new Error('boom');
        },
      },
    }));
    const init = {
      dolphy: 1,
      type: 'init',
      mode: 'markdown',
      rendererUrl: `${URL_PREFIX}/markdown.mjs`,
      language: 'boom',
      source: 'x',
    };
    boom.send(init);
    await boom.flush();
    expect(boom.posted.at(-1)).toMatchObject({
      type: 'error',
      message: 'boom',
    });

    const empty = setup(async () => ({ default: {} }));
    empty.send(init);
    await empty.flush();
    expect(empty.posted.at(-1)).toMatchObject({
      type: 'error',
      message: 'module has no default export with render()',
    });
  });

  it('dispose: прерывает signal, убирает содержимое и наблюдателя', async () => {
    const signals: { aborted: boolean }[] = [];
    const { send, flush, document } = setup(async () => ({
      default: {
        render: (
          _source: string,
          _container: HTMLElement,
          context: { signal: { aborted: boolean } },
        ) => {
          signals.push(context.signal);
        },
      },
    }));
    send({
      dolphy: 1,
      type: 'init',
      mode: 'markdown',
      rendererUrl: `${URL_PREFIX}/markdown.mjs`,
      language: 'math',
      source: 'x',
    });
    await flush();
    expect(document.body.children).toHaveLength(1);
    send({ dolphy: 1, type: 'dispose' });
    expect(signals[0]?.aborted).toBe(true);
    expect(document.body.children).toHaveLength(0);
    expect(FakeResizeObserver.instances[0]?.disconnected).toBe(true);
  });
});

describe('рантайм рамки: режим panel', () => {
  interface Context {
    panelId: string;
    props: unknown;
    signal: AbortSignal;
    call(command: string, args?: unknown): Promise<unknown>;
    onProps(listener: (props: unknown) => void): () => void;
  }

  const panelInit = (props: unknown = { from: 'open' }) => ({
    dolphy: 1,
    type: 'init',
    mode: 'panel',
    rendererUrl: `${URL_PREFIX}/panel.mjs`,
    panelId: 'acme.echo.main',
    props,
  });

  const mountPanel = async (
    mount?: (container: HTMLElement, ctx: Context) => void,
  ) => {
    const contexts: Context[] = [];
    const containers: HTMLElement[] = [];
    const harness = setup(async (url) => {
      expect(url).toBe(`${URL_PREFIX}/panel.mjs`);
      return {
        default: {
          mount: (container: HTMLElement, ctx: Context) => {
            containers.push(container);
            contexts.push(ctx);
            mount?.(container, ctx);
          },
        },
      };
    });
    harness.send(panelInit());
    await harness.flush();
    return { ...harness, ctx: contexts[0] as Context, containers };
  };

  const callsOf = (posted: Record<string, unknown>[]) =>
    posted.filter((message) => message['type'] === 'panel-call');

  const press = (
    harness: Awaited<ReturnType<typeof mountPanel>>,
    init: Record<string, unknown>,
  ) =>
    harness.document.dispatchEvent(
      new harness.happy.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ...init,
      }) as never,
    );

  it('монтирует модуль в контейнер, на всю высоту, и не сообщает size', async () => {
    const { ctx, containers, posted, document } = await mountPanel();
    expect(containers).toHaveLength(1);
    expect(document.body.contains(containers[0] as never)).toBe(true);
    expect(containers[0]?.style.height).toBe('100%');
    expect(ctx.panelId).toBe('acme.echo.main');
    expect(ctx.props).toEqual({ from: 'open' });
    expect(types(posted)).toEqual(['ready']);
    expect(FakeResizeObserver.instances).toHaveLength(0);
  });

  it('call: вызов уходит родителю, ответ завершает промис значением', async () => {
    const { ctx, send, posted, flush } = await mountPanel();
    const pending = ctx.call('acme.echo.ping', { n: 1 });
    const [call] = callsOf(posted);
    expect(call).toMatchObject({
      dolphyFrame: 1,
      type: 'panel-call',
      command: 'acme.echo.ping',
      args: { n: 1 },
    });
    send({
      dolphy: 1,
      type: 'panel-result',
      callId: call?.['callId'],
      ok: true,
      value: { pong: true },
    });
    await expect(pending).resolves.toEqual({ pong: true });
    await flush();
  });

  it('call: отказ — отклонённый промис с Error и текстом приложения', async () => {
    const { ctx, send, posted } = await mountPanel();
    const pending = ctx.call('acme.echo.ping');
    send({
      dolphy: 1,
      type: 'panel-result',
      callId: callsOf(posted)[0]?.['callId'],
      ok: false,
      error: { message: 'unknown command: x' },
    });
    await expect(pending).rejects.toThrow('unknown command: x');
  });

  it('параллельные вызовы различаются по callId; чужой и повторный ответ игнорируются', async () => {
    const { ctx, send, posted } = await mountPanel();
    const first = ctx.call('a');
    const second = ctx.call('b');
    const [one, two] = callsOf(posted);
    expect(one?.['callId']).not.toBe(two?.['callId']);
    send({
      dolphy: 1,
      type: 'panel-result',
      callId: 'nope',
      ok: true,
      value: 1,
    });
    send({
      dolphy: 1,
      type: 'panel-result',
      callId: two?.['callId'],
      ok: true,
      value: 'B',
    });
    send({
      dolphy: 1,
      type: 'panel-result',
      callId: two?.['callId'],
      ok: true,
      value: 'again',
    });
    send({
      dolphy: 1,
      type: 'panel-result',
      callId: one?.['callId'],
      ok: true,
      value: 'A',
    });
    await expect(Promise.all([first, second])).resolves.toEqual(['A', 'B']);
  });

  it('ответ принимается только от родителя', async () => {
    const { ctx, send, posted } = await mountPanel();
    const pending = ctx.call('a');
    const stranger = { postMessage: () => undefined };
    send(
      {
        dolphy: 1,
        type: 'panel-result',
        callId: callsOf(posted)[0]?.['callId'],
        ok: true,
        value: 'forged',
      },
      stranger,
    );
    const settled = vi.fn();
    void pending.then(settled, settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
  });

  it('call: слишком большие аргументы и не-JSON отклоняются сразу, ничего не уходит', async () => {
    const { ctx, posted } = await mountPanel();
    await expect(ctx.call('a', 'x'.repeat(200_001))).rejects.toThrow(
      'arguments are too large',
    );
    const loop: Record<string, unknown> = {};
    loop['self'] = loop;
    await expect(ctx.call('a', loop)).rejects.toThrow('arguments are not JSON');
    await expect(ctx.call('')).rejects.toThrow('command id');
    expect(callsOf(posted)).toHaveLength(0);
  });

  it('call: без ответа промис отклоняется по сроку (позже клиента движка)', async () => {
    vi.useFakeTimers();
    const { ctx } = await mountPanel();
    const outcome = vi.fn();
    void ctx.call('slow').catch(outcome);
    await vi.advanceTimersByTimeAsync(14_000);
    expect(outcome).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(outcome).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'command timed out' }),
    );
  });

  it('onProps: новые свойства доходят до слушателей, отписка работает', async () => {
    const { ctx, send } = await mountPanel();
    const listener = vi.fn();
    const off = ctx.onProps(listener);
    send({ dolphy: 1, type: 'panel-props', props: { n: 2 } });
    expect(listener).toHaveBeenCalledWith({ n: 2 });
    off();
    send({ dolphy: 1, type: 'panel-props', props: { n: 3 } });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('сбой слушателя свойств сообщается как error и не мешает остальным', async () => {
    const { ctx, send, posted } = await mountPanel();
    const healthy = vi.fn();
    ctx.onProps(() => {
      throw new Error('listener broke');
    });
    ctx.onProps(healthy);
    send({ dolphy: 1, type: 'panel-props', props: 1 });
    expect(healthy).toHaveBeenCalledWith(1);
    expect(posted.at(-1)).toMatchObject({
      type: 'error',
      message: 'listener broke',
    });
  });

  it('dispose: прерывает signal, отклоняет незавершённые вызовы и закрывает call', async () => {
    const { ctx, send, posted, document } = await mountPanel();
    const pending = ctx.call('a');
    const aborted = vi.fn();
    ctx.signal.addEventListener('abort', aborted);
    send({ dolphy: 1, type: 'dispose' });
    expect(ctx.signal.aborted).toBe(true);
    expect(aborted).toHaveBeenCalledOnce();
    await expect(pending).rejects.toThrow('frame is closed');
    await expect(ctx.call('b')).rejects.toThrow('frame is closed');
    expect(callsOf(posted)).toHaveLength(1);
    expect(document.body.children).toHaveLength(0);
  });

  it('модуль без mount() и неверный panelId — error', async () => {
    const empty = setup(async () => ({ default: {} }));
    empty.send(panelInit());
    await empty.flush();
    expect(empty.posted.at(-1)).toMatchObject({
      type: 'error',
      message: 'module has no default export with mount()',
    });
    const outside = setup(async () => ({}));
    outside.send({
      ...panelInit(),
      rendererUrl: 'dolphy-ext://evil.other/panel.mjs',
    });
    await outside.flush();
    expect(outside.posted.at(-1)).toMatchObject({
      type: 'error',
      message: 'renderer is outside the extension',
    });
  });

  it('пересылает родителю только Ctrl/⌘+K', async () => {
    const harness = await mountPanel();
    const sent = () =>
      harness.posted.filter((message) => message['type'] === 'shortcut');
    press(harness, { key: 'k', ctrlKey: true });
    press(harness, { key: 'K', metaKey: true });
    press(harness, { key: 'л', code: 'KeyK', ctrlKey: true });
    expect(sent()).toHaveLength(3);
    expect(sent()[0]).toEqual({
      dolphyFrame: 1,
      type: 'shortcut',
      key: 'mod+k',
    });

    const before = harness.posted.length;
    press(harness, { key: 'k' });
    press(harness, { key: 'k', ctrlKey: true, shiftKey: true });
    press(harness, { key: 'k', ctrlKey: true, altKey: true });
    press(harness, { key: 'j', ctrlKey: true });
    press(harness, { key: 'Escape' });
    press(harness, { key: 'Enter', ctrlKey: true });
    press(harness, { key: 'Tab' });
    expect(harness.posted).toHaveLength(before);
  });

  it('Ctrl+K: действие по умолчанию отменяется, автоповтор не шлёт повторно', async () => {
    const harness = await mountPanel();
    const event = new harness.happy.KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      cancelable: true,
    });
    harness.document.dispatchEvent(event as never);
    expect(event.defaultPrevented).toBe(true);
    press(harness, { key: 'k', ctrlKey: true, repeat: true });
    expect(harness.posted.filter((m) => m['type'] === 'shortcut')).toHaveLength(
      1,
    );
  });

  it('вне режима panel Ctrl/⌘+K не пересылается', async () => {
    const harness = setup();
    harness.define('x-answer');
    harness.send(answerInit());
    await harness.flush();
    harness.document.dispatchEvent(
      new harness.happy.KeyboardEvent('keydown', {
        key: 'k',
        ctrlKey: true,
        bubbles: true,
      }) as never,
    );
    expect(types(harness.posted)).not.toContain('shortcut');
  });
});

describe('рантайм рамки: окружение панели и виджета', () => {
  interface Context {
    context: { courseId: string | null };
    signal: AbortSignal;
    call(command: string, args?: unknown): Promise<unknown>;
    onContextChange(
      listener: (context: { courseId: string | null }) => void,
    ): () => void;
  }

  const init = (mode: 'panel' | 'widget', context?: unknown) => ({
    dolphy: 1,
    type: 'init',
    mode,
    rendererUrl: `${URL_PREFIX}/${mode}.mjs`,
    ...(mode === 'panel'
      ? { panelId: 'acme.echo.main', props: undefined }
      : { widgetId: 'acme.echo.card' }),
    ...(context === undefined ? {} : { context }),
  });

  const mount = async (mode: 'panel' | 'widget', context?: unknown) => {
    const seen: Context[] = [];
    const containers: HTMLElement[] = [];
    const harness = setup(async () => ({
      default: {
        mount: (container: HTMLElement, ctx: Context) => {
          containers.push(container);
          seen.push(ctx);
        },
      },
    }));
    harness.send(init(mode, context));
    await harness.flush();
    return { ...harness, ctx: seen[0] as Context, containers };
  };

  it.each(['panel', 'widget'] as const)(
    '%s: ctx.context — курс из init, замороженный объект; без окружения — все курсы',
    async (mode) => {
      const given = await mount(mode, { courseId: 'c1' });
      expect(given.ctx.context).toEqual({ courseId: 'c1' });
      expect(Object.isFrozen(given.ctx.context)).toBe(true);
      const none = await mount(mode);
      expect(none.ctx.context).toEqual({ courseId: null });
    },
  );

  it.each([
    ['число', { courseId: 5 }],
    ['пустая строка', { courseId: '' }],
    ['слишком длинный', { courseId: 'c'.repeat(201) }],
    ['не объект', 'c1'],
    ['лишние поля игнорируются', { courseId: null, admin: true }],
  ])(
    'init с недопустимым окружением (%s) даёт «все курсы»',
    async (_n, raw) => {
      const { ctx } = await mount('widget', raw);
      expect(ctx.context).toEqual({ courseId: null });
      expect(ctx.context).not.toHaveProperty('admin');
    },
  );

  it.each(['panel', 'widget'] as const)(
    '%s: сообщение context меняет ctx.context и зовёт слушателей без пересоздания рамки; повтор значения не зовёт, отписка работает',
    async (mode) => {
      const { ctx, send } = await mount(mode, { courseId: 'c1' });
      const held = ctx.context;
      const listener = vi.fn();
      const off = ctx.onContextChange(listener);

      send({ dolphy: 1, type: 'context', context: { courseId: 'c2' } });
      expect(ctx.context).toEqual({ courseId: 'c2' });
      expect(held).toEqual({ courseId: 'c1' });
      expect(listener).toHaveBeenCalledExactlyOnceWith({ courseId: 'c2' });

      send({ dolphy: 1, type: 'context', context: { courseId: 'c2' } });
      expect(listener).toHaveBeenCalledOnce();

      send({ dolphy: 1, type: 'context', context: { courseId: null } });
      expect(ctx.context).toEqual({ courseId: null });
      expect(listener).toHaveBeenCalledTimes(2);

      off();
      send({ dolphy: 1, type: 'context', context: { courseId: 'c3' } });
      expect(listener).toHaveBeenCalledTimes(2);
      expect(ctx.context).toEqual({ courseId: 'c3' });
    },
  );

  it('сбой слушателя окружения сообщается как error и не мешает остальным', async () => {
    const { ctx, send, posted } = await mount('widget', { courseId: null });
    const healthy = vi.fn();
    ctx.onContextChange(() => {
      throw new Error('listener broke');
    });
    ctx.onContextChange(healthy);
    send({ dolphy: 1, type: 'context', context: { courseId: 'c1' } });
    expect(healthy).toHaveBeenCalledWith({ courseId: 'c1' });
    expect(posted.at(-1)).toMatchObject({
      type: 'error',
      message: 'listener broke',
    });
  });

  it('вне панели и виджета сообщение context игнорируется', async () => {
    const harness = setup();
    harness.define('x-answer');
    harness.send({
      dolphy: 1,
      type: 'init',
      mode: 'answer',
      rendererUrl: `${URL_PREFIX}/view.mjs`,
      element: 'x-answer',
      label: 'a',
    });
    await harness.flush();
    const before = harness.posted.length;
    harness.send({ dolphy: 1, type: 'context', context: { courseId: 'c1' } });
    expect(harness.posted).toHaveLength(before);
  });
});

describe('рантайм рамки: режим widget', () => {
  interface WidgetCtx {
    widgetId: string;
    call(command: string, args?: unknown): Promise<unknown>;
  }

  const widgetInit = {
    dolphy: 1,
    type: 'init',
    mode: 'widget',
    rendererUrl: `${URL_PREFIX}/widget.mjs`,
    widgetId: 'acme.echo.card',
    context: { courseId: null },
  };

  const mountWidget = async (
    height = 150,
    onMount?: (height: { value: number }) => void,
  ) => {
    const contexts: WidgetCtx[] = [];
    const containers: HTMLElement[] = [];
    const harness = setup(async (url) => {
      expect(url).toBe(`${URL_PREFIX}/widget.mjs`);
      return {
        default: {
          mount: (container: HTMLElement, ctx: WidgetCtx) => {
            containers.push(container);
            contexts.push(ctx);
            onMount?.(harness.height);
          },
        },
      };
    });
    harness.height.value = height;
    harness.send(widgetInit);
    await harness.flush();
    return { ...harness, ctx: contexts[0] as WidgetCtx, containers };
  };

  it('монтирует модуль с widgetId и сообщает высоту содержимого, а не заполняет рамку', async () => {
    const { ctx, containers, posted, document, height } = await mountWidget();
    expect(ctx.widgetId).toBe('acme.echo.card');
    expect(ctx).not.toHaveProperty('props');
    expect(document.body.contains(containers[0] as never)).toBe(true);
    expect(containers[0]?.style.height).toBe('');
    expect(document.body.style.height).toBe('');
    expect(posted).toContainEqual({
      dolphyFrame: 1,
      type: 'size',
      height: 150,
    });
    height.value = 400;
    FakeResizeObserver.instances[0]?.fire();
    expect(posted.at(-1)).toEqual({
      dolphyFrame: 1,
      type: 'size',
      height: 400,
    });
  });

  it('высота после монтирования читается сразу, не дожидаясь ResizeObserver (он молчит в нерисуемой рамке)', async () => {
    const { posted } = await mountWidget(0, (height) => {
      // содержимое, которое модуль добавил в mount()
      height.value = 300;
    });
    // наблюдатель не срабатывал ни разу
    expect(posted.filter((m) => m['type'] === 'size').at(-1)).toEqual({
      dolphyFrame: 1,
      type: 'size',
      height: 300,
    });
  });

  it('call и Ctrl/⌘+K работают как у панели', async () => {
    const harness = await mountWidget();
    void harness.ctx.call('acme.echo.ping', { n: 1 });
    expect(harness.posted).toContainEqual(
      expect.objectContaining({
        type: 'panel-call',
        command: 'acme.echo.ping',
        args: { n: 1 },
      }),
    );
    harness.document.dispatchEvent(
      new harness.happy.KeyboardEvent('keydown', {
        key: 'k',
        ctrlKey: true,
        cancelable: true,
      }) as never,
    );
    expect(harness.posted.filter((m) => m['type'] === 'shortcut')).toHaveLength(
      1,
    );
  });

  it('dispose отключает наблюдатель размера и закрывает call', async () => {
    const { ctx, send, document } = await mountWidget();
    send({ dolphy: 1, type: 'dispose' });
    expect(FakeResizeObserver.instances[0]?.disconnected).toBe(true);
    await expect(ctx.call('a')).rejects.toThrow('closed');
    expect(document.body.children).toHaveLength(0);
  });

  it('неверный widgetId и модуль без mount() — error', async () => {
    const wrongId = setup(async () => ({
      default: { mount: () => undefined },
    }));
    wrongId.send({ ...widgetInit, widgetId: 5 });
    await wrongId.flush();
    expect(wrongId.posted.at(-1)).toMatchObject({
      type: 'error',
      message: 'invalid widget id',
    });
    const empty = setup(async () => ({ default: {} }));
    empty.send(widgetInit);
    await empty.flush();
    expect(empty.posted.at(-1)).toMatchObject({
      type: 'error',
      message: 'module has no default export with mount()',
    });
  });
});
