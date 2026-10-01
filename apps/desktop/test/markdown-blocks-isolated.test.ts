// @vitest-environment happy-dom
import type { MarkdownRendererDto } from '@dolphy-app/engine-contract';
import { describe, expect, it, vi } from 'vitest';
import { hydrateMarkdownBlocks } from '../src/shared/lib/markdown-blocks.ts';
import { createMarkdownRenderer } from '../src/shared/lib/markdown.ts';

const renderers: MarkdownRendererDto[] = [
  {
    language: 'wild',
    extensionId: 'acme.wild',
    rendererUrl: 'dolphy-ext://acme.wild/markdown.mjs',
    isolated: true,
    origin: 'user',
    revision: 'rev-1',
  },
  {
    language: 'math',
    extensionId: 'dolphy.math',
    rendererUrl: 'dolphy-ext://dolphy.math/markdown.mjs',
    isolated: false,
    origin: 'bundled',
    revision: '',
  },
];

const mount = (source: string) => {
  const root = document.createElement('div');
  root.innerHTML = createMarkdownRenderer(new Set(['wild', 'math']))(source);
  return root;
};

/** Рамка блока: подставляем `contentWindow` (в happy-dom страница рамки не грузится). */
const attachWindow = (frame: HTMLIFrameElement) => {
  const posted: Record<string, unknown>[] = [];
  const contentWindow = {
    postMessage: (message: Record<string, unknown>) => posted.push(message),
  };
  Object.defineProperty(frame, 'contentWindow', { value: contentWindow });
  const send = (
    message: Record<string, unknown>,
    source: unknown = contentWindow,
  ) =>
    window.dispatchEvent(
      Object.assign(new Event('message'), {
        data: { dolphyFrame: 1, ...message },
        source,
      }),
    );
  return { posted, send };
};

const start = (root: HTMLElement, signal = new AbortController().signal) => {
  const loadModule = vi.fn();
  const done = hydrateMarkdownBlocks({
    root,
    renderers,
    signal,
    describeError: (language) => `failed:${language}`,
    describeFrame: (language) => `frame:${language}`,
    loadModule: loadModule as never,
  });
  const frame = root.querySelector('iframe') as HTMLIFrameElement;
  return { done, frame, loadModule };
};

describe('изолированный рендерер блока Markdown', () => {
  it('блок получает iframe с sandbox="allow-scripts", исходник остаётся, пока рамка не готова', () => {
    const root = mount('```wild\nraw <b>x</b>\n```');
    const { frame, loadModule } = start(root);
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('src')).toBe(
      'dolphy-ext://acme.wild/__dolphy/frame.html',
    );
    expect(frame.title).toBe('frame:wild');
    expect(frame.dataset.mode).toBe('markdown');
    expect(loadModule).not.toHaveBeenCalled();
    const block = root.querySelector('.dolphy-md-block');
    expect(block?.getAttribute('data-state')).toBe('loading');
    expect(block?.querySelector('pre code')?.textContent).toBe(
      'raw <b>x</b>\n',
    );
  });

  it('ready → init с исходником; size → высота; done → готово и исходник заменён рамкой', async () => {
    const root = mount('```wild\nE=mc^2\n```');
    const { done, frame } = start(root);
    const { posted, send } = attachWindow(frame);
    send({ type: 'ready' });
    expect(posted[0]).toMatchObject({
      dolphy: 1,
      type: 'init',
      mode: 'markdown',
      rendererUrl: 'dolphy-ext://acme.wild/markdown.mjs',
      language: 'wild',
      source: 'E=mc^2\n',
    });
    send({ type: 'size', height: 222 });
    expect(frame.style.height).toBe('222px');
    send({ type: 'done' });
    await done;
    const block = root.querySelector('.dolphy-md-block');
    expect(block?.getAttribute('data-state')).toBe('done');
    expect(block?.querySelector('pre')).toBeNull();
    expect(block?.contains(frame)).toBe(true);
    expect(frame.style.visibility).toBe('visible');
  });

  it('error рамки: исходник и заметка остаются, рамка убрана', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const root = mount('```wild\nraw\n```');
    const { done, frame } = start(root);
    const { send } = attachWindow(frame);
    send({ type: 'error', message: 'boom' });
    await done;
    const block = root.querySelector('.dolphy-md-block');
    expect(block?.getAttribute('data-state')).toBe('error');
    expect(block?.querySelector('pre code')?.textContent).toBe('raw\n');
    expect(block?.querySelector('p.dolphy-md-error')?.textContent).toBe(
      'failed:wild',
    );
    expect(root.querySelector('iframe')).toBeNull();
  });

  it('done от постороннего окна не завершает блок', () => {
    const root = mount('```wild\nraw\n```');
    const { frame } = start(root);
    const { send } = attachWindow(frame);
    send({ type: 'done' }, { postMessage: () => undefined });
    const block = root.querySelector('.dolphy-md-block');
    expect(block?.getAttribute('data-state')).toBe('loading');
    expect(block?.querySelector('pre')).not.toBeNull();
  });

  it('прерывание до готовности возвращает блок в ожидание и убирает рамку', async () => {
    const root = mount('```wild\nraw\n```');
    const controller = new AbortController();
    const { done, frame } = start(root, controller.signal);
    attachWindow(frame);
    controller.abort();
    await done;
    const block = root.querySelector('.dolphy-md-block');
    expect(block?.getAttribute('data-state')).toBe('pending');
    expect(block?.querySelector('pre')).not.toBeNull();
    expect(root.querySelector('iframe')).toBeNull();
  });

  it('прерывание после готовности отключает мост, но оставляет вывод', async () => {
    const root = mount('```wild\nraw\n```');
    const controller = new AbortController();
    const { done, frame } = start(root, controller.signal);
    const { posted, send } = attachWindow(frame);
    send({ type: 'ready' });
    send({ type: 'done' });
    await done;
    controller.abort();
    expect(posted.at(-1)).toEqual({ dolphy: 1, type: 'dispose' });
    send({ type: 'size', height: 500 });
    expect(frame.style.height).not.toBe('500px');
    expect(
      root.querySelector('.dolphy-md-block')?.getAttribute('data-state'),
    ).toBe('done');
  });

  it('блок с доверенным рендерером идёт прежним путём, без рамки', async () => {
    const root = mount('```math\nx\n```\n\n```wild\ny\n```');
    const render = vi.fn((_source: string, container: HTMLElement) => {
      container.innerHTML = '<svg></svg>';
    });
    const loadModule = vi.fn(async () => ({ render }));
    const done = hydrateMarkdownBlocks({
      root,
      renderers,
      signal: new AbortController().signal,
      describeError: (language) => `failed:${language}`,
      loadModule: loadModule as never,
    });
    // доверенный блок идёт первым и ждёт модуль: рамка появляется после него
    await vi.waitFor(() => expect(root.querySelector('iframe')).not.toBeNull());
    const frame = root.querySelector('iframe') as HTMLIFrameElement;
    const { send } = attachWindow(frame);
    send({ type: 'done' });
    await done;
    expect(loadModule).toHaveBeenCalledOnce();
    expect(loadModule).toHaveBeenCalledWith(
      'dolphy-ext://dolphy.math/markdown.mjs',
    );
    expect(root.querySelector('[data-language=math] svg')).not.toBeNull();
    expect(root.querySelectorAll('iframe')).toHaveLength(1);
  });
});
