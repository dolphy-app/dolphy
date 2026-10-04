import MarkdownIt from 'markdown-it';
import { highlightCode } from './highlight.ts';

export const MARKDOWN_BLOCK_CLASS = 'dolphy-md-block';

/**
 * `languages` — языки блоков кода, которые объявили рендереры расширений.
 * Такой блок выводится заглушкой с исходником; остальные блоки — обычный код.
 * html: false — сырой HTML из материалов курса не попадает в страницу.
 */
export const createMarkdownRenderer = (languages: ReadonlySet<string>) => {
  const markdown = new MarkdownIt({
    html: false,
    linkify: false,
    // языки рендереров расширений сюда не доходят: их блок выводит `fence` ниже;
    // '' — markdown-it сам экранирует код
    highlight: (code, language) => highlightCode(code, language) ?? '',
  });

  // прокручиваемый блок кода должен получать фокус, иначе с клавиатуры его
  // не прокрутить (axe `scrollable-region-focusable`)
  for (const rule of ['fence', 'code_block'] as const) {
    const render = markdown.renderer.rules[rule];
    if (!render) throw new Error(`markdown-it has no "${rule}" rule`);
    markdown.renderer.rules[rule] = (...args) =>
      render(...args).replace('<pre', '<pre tabindex="0"');
  }

  const defaultFence = markdown.renderer.rules.fence;
  markdown.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const language = token?.info.trim().split(/\s+/)[0] ?? '';
    if (token === undefined || !languages.has(language)) {
      return defaultFence
        ? defaultFence(tokens, index, options, env, self)
        : '';
    }
    const { escapeHtml } = markdown.utils;
    return (
      `<div class="${MARKDOWN_BLOCK_CLASS}" data-language="${escapeHtml(language)}"` +
      ` data-state="pending"><pre tabindex="0"><code>${escapeHtml(token.content)}</code></pre></div>\n`
    );
  };
  return (source: string): string => markdown.render(source);
};
