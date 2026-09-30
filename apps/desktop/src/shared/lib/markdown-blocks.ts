import type { MarkdownRendererDto } from '@spirula/engine-contract';
import type { MarkdownRendererModule } from '@spirula/extension-api';
import { createFrameHost, frameUrlOf } from '@/shared/lib/frame-bridge.ts';
import type { FrameHost } from '@/shared/lib/frame-bridge.ts';
import { MARKDOWN_BLOCK_CLASS } from './markdown.ts';

export type LoadMarkdownModule = (
  url: string,
) => Promise<MarkdownRendererModule<HTMLElement>>;

export interface HydrateOptions {
  root: ParentNode;
  renderers: readonly MarkdownRendererDto[];
  loadModule?: LoadMarkdownModule;
  signal: AbortSignal;
  /** Текст заметки об ошибке (i18n на стороне вызывающего). */
  describeError: (language: string) => string;
  /** Заголовок (`title`) изолированной рамки блока; по умолчанию — язык. */
  describeFrame?: (language: string) => string;
}

const moduleCache = new Map<string, Promise<unknown>>();

export const importMarkdownModule: LoadMarkdownModule = async (url) => {
  let loading = moduleCache.get(url);
  if (loading === undefined) {
    loading = import(/* @vite-ignore */ url);
    moduleCache.set(url, loading);
    loading.catch(() => moduleCache.delete(url));
  }
  const loaded = (await loading) as {
    default?: MarkdownRendererModule<HTMLElement>;
  };
  const module = loaded.default;
  if (typeof module?.render !== 'function') {
    throw new Error(`module ${url} has no default export with render()`);
  }
  return module;
};

const fail = (
  block: HTMLElement,
  language: string,
  error: unknown,
  describeError: HydrateOptions['describeError'],
) => {
  console.error({ error, language }, 'markdown block was not rendered');
  block.dataset.state = 'error';
  const note = block.ownerDocument.createElement('p');
  note.className = 'spirula-md-error';
  note.setAttribute('role', 'note');
  note.textContent = describeError(language);
  block.append(note);
};

const release = (block: HTMLElement) => {
  block.dataset.state = 'pending';
};

interface FrameBlock {
  block: HTMLElement;
  pre: HTMLElement | null;
  renderer: MarkdownRendererDto;
  language: string;
  source: string;
  title: string;
  signal: AbortSignal;
}

/**
 * Блок недоверенного рендерера выводится в `iframe sandbox="allow-scripts"`:
 * исходник остаётся на месте, пока рамка не сообщит `done`; по `error` или
 * прерыванию рамка убирается, исходник остаётся.
 */
const renderInFrame = ({
  block,
  pre,
  renderer,
  language,
  source,
  title,
  signal,
}: FrameBlock) =>
  new Promise<void>((resolve, reject) => {
    const frame = block.ownerDocument.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.dataset.mode = 'markdown';
    frame.title = title;
    frame.src = frameUrlOf(renderer.rendererUrl);
    frame.style.cssText =
      'display:block;width:100%;height:0;border:0;visibility:hidden;background:transparent';
    block.append(frame);
    const link: { host: FrameHost | null } = { host: null };
    link.host = createFrameHost({
      frame,
      init: {
        mode: 'markdown',
        rendererUrl: renderer.rendererUrl,
        language,
        source,
      },
      handlers: {
        onSize: (height) => {
          frame.style.height = `${height}px`;
        },
        onDone: () => {
          pre?.remove();
          frame.style.visibility = 'visible';
          resolve();
        },
        onError: (message) => {
          link.host?.dispose();
          frame.remove();
          reject(new Error(message));
        },
      },
    });
    // рамка живёт, пока живёт вывод блока: прерывание снимает слушателей
    signal.addEventListener(
      'abort',
      () => {
        link.host?.dispose();
        if (frame.style.visibility === 'hidden') {
          frame.remove();
          reject(new DOMException('aborted', 'AbortError'));
        }
      },
      { once: true },
    );
  });

/** Заменяет заглушки блоков результатом рендереров; сбой оставляет исходник. */
export const hydrateMarkdownBlocks = async (
  options: HydrateOptions,
): Promise<void> => {
  const { root, renderers, signal, describeError } = options;
  const describeFrame = options.describeFrame ?? ((language) => language);
  const loadModule = options.loadModule ?? importMarkdownModule;
  const byLanguage = new Map(renderers.map((r) => [r.language, r]));
  const blocks = root.querySelectorAll<HTMLElement>(
    `.${MARKDOWN_BLOCK_CLASS}[data-state="pending"]`,
  );
  const framed: Promise<void>[] = [];

  const hydrateFramed = async (
    block: HTMLElement,
    renderer: MarkdownRendererDto,
  ) => {
    const language = block.dataset.language ?? '';
    const pre = block.querySelector('pre');
    const source = pre?.querySelector('code')?.textContent ?? '';
    try {
      await renderInFrame({
        block,
        pre,
        renderer,
        language,
        source,
        title: describeFrame(language),
        signal,
      });
      block.dataset.state = 'done';
    } catch (error) {
      if (signal.aborted) release(block);
      else fail(block, language, error, describeError);
    }
  };

  for (const block of blocks) {
    if (signal.aborted) break;
    block.dataset.state = 'loading';
    const language = block.dataset.language ?? '';
    const renderer = byLanguage.get(language);
    if (renderer?.isolated) {
      // рамки грузятся параллельно: каждая — отдельный документ
      framed.push(hydrateFramed(block, renderer));
      continue;
    }
    try {
      if (renderer === undefined)
        throw new Error(`no renderer for '${language}'`);
      const module = await loadModule(renderer.rendererUrl);
      if (signal.aborted) {
        release(block);
        break;
      }
      const pre = block.querySelector('pre');
      const source = pre?.querySelector('code')?.textContent ?? '';
      const container = block.ownerDocument.createElement('div');
      await module.render(source, container, { language, signal });
      if (signal.aborted) {
        release(block);
        break;
      }
      pre?.replaceWith(container);
      block.dataset.state = 'done';
    } catch (error) {
      if (signal.aborted) {
        release(block);
        break;
      }
      fail(block, language, error, describeError);
    }
  }
  await Promise.all(framed);
};
