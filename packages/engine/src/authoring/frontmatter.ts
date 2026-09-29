/**
 * Определение YAML-frontmatter (общее для компилятора и рантайм-`readAsset`).
 *
 * Правило: файл (после необязательного BOM) начинается со строки ровно `---`
 * (хвостовые пробелы и CRLF допустимы), дальше есть закрывающая строка `---`
 * или `...`. Блок между ними пуст либо его первая значимая строка выглядит как
 * `key:`, иначе файл — обычный Markdown с thematic break. Открыть блок может
 * только первая строка, поэтому пары `---` в теле не разбираются. Открытый, но
 * не закрытый блок сообщается как `unterminated`, ничего не срезается.
 * Модуль не зависит от yaml и синхронен.
 */

export interface FrontmatterSplit {
  /** Текст между заборами (без них) или `null`, если frontmatter нет. */
  front: string | null;
  /** Документ без frontmatter; равен входу, если ничего не срезано. */
  body: string;
  /** Строка (1-based) первой строки внутри блока; 2 — сразу после забора. */
  frontStartLine: number;
  unterminated: boolean;
}

const BOM = 0xfeff;
const DASH = 0x2d;

const KEY_LINE =
  /^[^\s#\-[\]{},&*!|>'"%@`][^\n]*?:(\s|$)|^["'][^\n]*["']\s*:(\s|$)/;

const isFence = (line: string, allowDots: boolean): boolean => {
  const withoutCr = line.endsWith('\r') ? line.slice(0, -1) : line;
  const trimmed = withoutCr.replace(/[ \t]+$/, '');
  return trimmed === '---' || (allowDots && trimmed === '...');
};

export const splitFrontmatter = (text: string): FrontmatterSplit => {
  const none: FrontmatterSplit = {
    front: null,
    body: text,
    frontStartLine: 0,
    unterminated: false,
  };
  const start = text.charCodeAt(0) === BOM ? 1 : 0;
  // Быстрый отказ: первый символ обязан быть '-'.
  if (text.charCodeAt(start) !== DASH) return none;
  let eol = text.indexOf('\n', start);
  if (eol < 0) eol = text.length;
  if (!isFence(text.slice(start, eol), false)) return none;

  const contentStart = Math.min(eol + 1, text.length);
  let pos = contentStart;
  let firstSignificant: string | null = null;
  while (pos <= text.length) {
    let end = text.indexOf('\n', pos);
    if (end < 0) end = text.length;
    const line = text.slice(pos, end);
    if (isFence(line, true)) {
      // `---` + проза + `---` — thematic break, а не frontmatter.
      if (firstSignificant !== null && !KEY_LINE.test(firstSignificant)) {
        return none;
      }
      return {
        front: text.slice(contentStart, pos),
        body: text.slice(Math.min(end + 1, text.length)),
        frontStartLine: 2,
        unterminated: false,
      };
    }
    if (firstSignificant === null) {
      const trimmed = line.trim();
      if (trimmed !== '' && !trimmed.startsWith('#')) {
        firstSignificant = line.replace(/\r$/, '');
      }
    }
    if (end >= text.length) break;
    pos = end + 1;
  }
  // Не закрыт: ошибка только если первая значимая строка похожа на YAML.
  if (firstSignificant !== null && KEY_LINE.test(firstSignificant)) {
    return { front: null, body: text, frontStartLine: 2, unterminated: true };
  }
  return none;
};

/** Правило `readAsset`: Markdown без frontmatter. */
export const stripFrontmatter = (text: string): string => {
  const split = splitFrontmatter(text);
  return split.front === null ? text : split.body;
};
