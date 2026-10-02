import type { Command } from '@/shared/lib/command-registry.ts';

const lower = (text: string | undefined): string => (text ?? '').toLowerCase();

const compare = (left: string, right: string): number => {
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

/** Порядок без запроса: по категории (без категории — в конце), названию, ключу. */
const byDefaultOrder = (left: Command, right: Command): number => {
  const leftCategory = lower(left.category);
  const rightCategory = lower(right.category);
  if ((leftCategory === '') !== (rightCategory === '')) {
    return leftCategory === '' ? 1 : -1;
  }
  return (
    compare(leftCategory, rightCategory) ||
    compare(lower(left.title), lower(right.title)) ||
    compare(left.key, right.key)
  );
};

const TITLE_PREFIX = 0;
const TITLE_WORD = 1;
const TITLE_PART = 2;
const CATEGORY_PART = 3;
const CAPTION_PART = 4;

/** Насколько хорошо слово запроса совпало с командой; `null` — не совпало. */
const scoreTerm = (command: Command, term: string) => {
  const title = lower(command.title);
  if (title.startsWith(term)) return TITLE_PREFIX;
  if (title.includes(` ${term}`)) return TITLE_WORD;
  if (title.includes(term)) return TITLE_PART;
  if (lower(command.category).includes(term)) return CATEGORY_PART;
  if (lower(command.caption).includes(term)) return CAPTION_PART;
  return null;
};

/**
 * Строки палитры: доступные и не скрытые из палитры команды, которые содержат каждое слово запроса
 * (без учёта регистра) в названии, категории или подписи (у команд расширений —
 * id расширения). Без запроса — по категории и названию; с запросом — по
 * близости совпадения, при равенстве — в том же порядке.
 */
export const filterCommands = (
  commands: readonly Command[],
  query: string,
): Command[] => {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored: { command: Command; score: number }[] = [];
  for (const command of commands) {
    if (!command.enabled || !command.listed) continue;
    let score = 0;
    let matches = true;
    for (const term of terms) {
      const termScore = scoreTerm(command, term);
      if (termScore === null) {
        matches = false;
        break;
      }
      score += termScore;
    }
    if (matches) scored.push({ command, score });
  }
  return scored
    .sort(
      (left, right) =>
        left.score - right.score || byDefaultOrder(left.command, right.command),
    )
    .map(({ command }) => command);
};
