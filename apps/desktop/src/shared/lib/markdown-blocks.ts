import { MARKDOWN_BLOCK_CLASS } from './markdown.ts';

/** Место блока рендерера в разметке: заглушка, язык и исходный текст. */
export interface MarkdownBlockSlot {
  element: HTMLElement;
  language: string;
  source: string;
}

/**
 * Заглушки блоков рендереров в разметке документа. Компоненты расширений
 * рисуются в них через `Teleport`, исходник остаётся на месте, пока блок не
 * готов.
 */
export const collectMarkdownBlocks = (root: ParentNode): MarkdownBlockSlot[] =>
  [...root.querySelectorAll<HTMLElement>(`.${MARKDOWN_BLOCK_CLASS}`)].map(
    (element) => ({
      element,
      language: element.dataset['language'] ?? '',
      source: element.querySelector('pre code')?.textContent ?? '',
    }),
  );
