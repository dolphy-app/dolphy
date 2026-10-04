import { highlight } from 'sugar-high';

/** Длиннее этого слой подсветки не строится: ответ и так ограничен, но поле не должно тормозить. */
export const MAX_HIGHLIGHT_CHARS = 20_000;

/** Токены цвета текста: их `<span>` ничего не красит. */
const NEUTRAL =
  /<span class="sh__token--(?:space|identifier|sign|jsxliterals|break)">([^<]*)<\/span>/g;

/**
 * HTML подсвеченного JavaScript или `null` (слишком длинный текст, сбой
 * разбора): тогда слой показывает текст без цвета. Значения токенов
 * экранированы, `<` внутри них нет, поэтому замена по `[^<]*` точна.
 */
export const highlightJs = (code: string): string | null => {
  if (code.length > MAX_HIGHLIGHT_CHARS) return null;
  try {
    return highlight(code, {
      lang: 'javascript',
      mark(token) {
        token.style = {};
      },
    }).replace(NEUTRAL, '$1');
  } catch {
    return null;
  }
};
