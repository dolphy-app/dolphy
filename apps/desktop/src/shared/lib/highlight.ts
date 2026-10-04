import { highlight } from 'sugar-high';
import { lang as canonicalLanguage } from 'sugar-high/lang';

/**
 * Дольше этого код не подсвечивается: курс из git может принести любой текст,
 * а подсветка нужна для учебных фрагментов, не для файлов.
 */
export const MAX_HIGHLIGHT_CHARS = 50_000;

/** Типы токенов, которые читаются цветом текста блока: их `<span>` ничего не красит. */
const NEUTRAL_TOKENS = 'space|identifier|sign|jsxliterals|break';
const NEUTRAL = new RegExp(
  `<span class="sh__token--(?:${NEUTRAL_TOKENS})">([^<]*)</span>`,
  'g',
);

/**
 * Подсвеченный HTML содержимого блока кода или `null`, если язык неизвестен,
 * не указан или код слишком длинный (тогда блок остаётся обычным).
 *
 * Цвет токена задаёт CSS класса `sh__token--<тип>` (см. `MarkdownView`), поэтому
 * `style` у токенов не нужен, а токены цвета текста снимаются совсем: значения
 * экранированы, `<` внутри них быть не может, и замена по `[^<]*` точна.
 */
export const highlightCode = (
  code: string,
  language: string,
): string | null => {
  if (language === '' || code.length > MAX_HIGHLIGHT_CHARS) return null;
  const canonical = canonicalLanguage(language);
  if (canonical === undefined || canonical === 'plaintext') return null;
  try {
    return highlight(code, {
      lang: canonical,
      mark(token) {
        token.style = {};
      },
    }).replace(NEUTRAL, '$1');
  } catch (error) {
    console.error({ error, language }, 'code block was not highlighted');
    return null;
  }
};
