import type { MarkdownRendererDto } from '@lms/engine-contract';
import type { MarkdownRendererModule } from '@lms/extension-api';
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
  note.className = 'lms-md-error';
  note.setAttribute('role', 'note');
  note.textContent = describeError(language);
  block.append(note);
};

const release = (block: HTMLElement) => {
  block.dataset.state = 'pending';
};

/** Заменяет заглушки блоков результатом рендереров; сбой оставляет исходник. */
export const hydrateMarkdownBlocks = async (
  options: HydrateOptions,
): Promise<void> => {
  const { root, renderers, signal, describeError } = options;
  const loadModule = options.loadModule ?? importMarkdownModule;
  const urls = new Map(renderers.map((r) => [r.language, r.rendererUrl]));
  const blocks = root.querySelectorAll<HTMLElement>(
    `.${MARKDOWN_BLOCK_CLASS}[data-state="pending"]`,
  );
  for (const block of blocks) {
    if (signal.aborted) return;
    block.dataset.state = 'loading';
    const language = block.dataset.language ?? '';
    try {
      const url = urls.get(language);
      if (url === undefined) throw new Error(`no renderer for '${language}'`);
      const module = await loadModule(url);
      if (signal.aborted) {
        release(block);
        return;
      }
      const pre = block.querySelector('pre');
      const source = pre?.querySelector('code')?.textContent ?? '';
      const container = block.ownerDocument.createElement('div');
      await module.render(source, container, { language, signal });
      if (signal.aborted) {
        release(block);
        return;
      }
      pre?.replaceWith(container);
      block.dataset.state = 'done';
    } catch (error) {
      if (signal.aborted) {
        release(block);
        return;
      }
      fail(block, language, error, describeError);
    }
  }
};
