/** Длиннее этого первый абзац читается как текст, а не как заголовок вопроса. */
export const HEADLINE_MAX_CHARS = 140;

const BLOCK_MARKERS = /^(```|~~~|#|[-*+]\s|>|\||\d+[.)]\s)/;

export interface PromptParts {
  /** Первый абзац условия — сам вопрос; пусто, если условие начинается с блока. */
  lead: string;
  /** Остальное условие (код, пояснения). */
  rest: string;
  /** Вопрос короткий: его набирают заголовком, длинный — обычным текстом. */
  headline: boolean;
}

/**
 * Делит Markdown условия на вопрос и остальное. Раньше всё условие набиралось
 * крупным заголовочным шрифтом, и длинная формулировка с кодом превращалась в
 * стену крупного текста.
 */
export const splitPrompt = (source: string): PromptParts => {
  const text = source.trim();
  if (text === '' || BLOCK_MARKERS.test(text)) {
    return { lead: '', rest: text, headline: false };
  }
  const blank = text.search(/\n[ \t]*\n/);
  const lead = blank < 0 ? text : text.slice(0, blank);
  const rest = blank < 0 ? '' : text.slice(blank).trim();
  return {
    lead,
    rest,
    headline: lead.length <= HEADLINE_MAX_CHARS && !lead.includes('\n'),
  };
};
