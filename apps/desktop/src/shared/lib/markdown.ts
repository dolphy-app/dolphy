import MarkdownIt from 'markdown-it';
import { highlightCode } from './highlight.ts';

export const MARKDOWN_BLOCK_CLASS = 'dolphy-md-block';

/** Врезки в стиле GitHub: цитата, первая строка которой — `[!NOTE]`, `[!TIP]` и т. д. */
export const CALLOUT_KINDS = [
  'note',
  'tip',
  'important',
  'warning',
  'caution',
] as const;

const CALLOUT_MARKER = new RegExp(
  `^\\[!(${CALLOUT_KINDS.join('|')})\\][ \\t]*`,
  'i',
);

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

  // `> [!WARNING]` → цитата с классом `callout callout--warning`, без маркера в
  // тексте. Без поддержки рендера (старое приложение) остаётся обычной цитатой.
  markdown.core.ruler.push('callout', (state) => {
    const { tokens } = state;
    for (let index = 0; index < tokens.length; index += 1) {
      const open = tokens[index];
      const inline = tokens[index + 2];
      if (
        open?.type !== 'blockquote_open' ||
        tokens[index + 1]?.type !== 'paragraph_open' ||
        inline?.type !== 'inline'
      ) {
        continue;
      }
      const marker = CALLOUT_MARKER.exec(inline.content);
      const kind = marker?.[1]?.toLowerCase();
      if (marker === null || kind === undefined) continue;
      open.attrJoin('class', `callout callout--${kind}`);
      inline.content = inline.content
        .slice(marker[0].length)
        .replace(/^\n/, '');
      const children = inline.children ?? [];
      const first = children[0];
      if (first?.type === 'text') {
        first.content = first.content.replace(CALLOUT_MARKER, '');
        if (first.content === '') children.shift();
        if (children[0]?.type === 'softbreak') children.shift();
      }
      // в абзаце был только маркер: пустой <p> не нужен
      if (inline.content === '') tokens.splice(index + 1, 3);
    }
    return true;
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
