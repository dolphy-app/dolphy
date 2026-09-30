// @vitest-environment happy-dom
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import runtimeSource from '../electron/main/shells/frame-runtime.js?raw';

type LoadModule = (url: string) => Promise<unknown>;
type Runtime = (win: unknown, loadModule: LoadModule) => void;

const runtime = new Function(
  `${runtimeSource}\nreturn spirulaFrameRuntime;`,
)() as Runtime;

const URL_PREFIX = 'spirula-ext://acme.echo';

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
      location: new URL(`${URL_PREFIX}/__spirula/frame.html`),
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
  spirula: 1,
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
  it('сообщает ready и помечает сообщения маркером spirulaFrame', () => {
    const { posted } = setup();
    expect(posted).toEqual([{ spirulaFrame: 1, type: 'ready' }]);
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
      spirula: 1,
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
    send({ spirula: 1, type: 'props', view: 'early', disabled: true });
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
      new CustomEvent('spirula-answer-change', {
        detail: { value: 'select 1', complete: true, extra: 1 },
      }),
    );
    element.dispatchEvent(new CustomEvent('spirula-answer-submit'));
    expect(posted).toContainEqual({
      spirulaFrame: 1,
      type: 'answer-change',
      detail: { value: 'select 1', complete: true },
    });
    expect(types(posted)).toContain('answer-submit');
  });

  it('игнорирует сообщения не от родителя и без маркера', async () => {
    const { send, define, flush, document, posted } = setup();
    define('x-answer');
    send(answerInit(), { postMessage: () => undefined });
    send({ ...answerInit(), spirula: 2 });
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
    send({ ...answerInit(), rendererUrl: 'spirula-ext://other.ext/view.mjs' });
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
      spirulaFrame: 1,
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
        el.dispatchEvent(new CustomEvent('spirula-answer-submit')),
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
      spirula: 1,
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
      spirula: 1,
      type: 'theme',
      variables: { '--v-theme-primary': '9,9,9' },
      dark: false,
    });
    expect(style.getPropertyValue('--v-theme-primary')).toBe('9,9,9');
    expect(style.getPropertyValue('--v-border-opacity')).toBe('');
    expect(style.getPropertyValue('color-scheme')).toBe('light');
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
      spirula: 1,
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
      spirula: 1,
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
      spirula: 1,
      type: 'init',
      mode: 'markdown',
      rendererUrl: `${URL_PREFIX}/markdown.mjs`,
      language: 'math',
      source: 'x',
    });
    await flush();
    expect(document.body.children).toHaveLength(1);
    send({ spirula: 1, type: 'dispose' });
    expect(signals[0]?.aborted).toBe(true);
    expect(document.body.children).toHaveLength(0);
    expect(FakeResizeObserver.instances[0]?.disconnected).toBe(true);
  });
});
