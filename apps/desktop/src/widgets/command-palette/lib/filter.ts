import type { CommandContributionDto } from '@dolphy-app/engine-contract';

export interface PaletteEntry {
  /** `${extensionId}:${id}`: идентичность строки между обновлениями вкладов. */
  key: string;
  command: CommandContributionDto;
}

export const commandKey = (
  command: Pick<CommandContributionDto, 'extensionId' | 'id'>,
): string => `${command.extensionId}:${command.id}`;

const lower = (text: string | null): string => (text ?? '').toLowerCase();

const compare = (left: string, right: string): number => {
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

/** Порядок без запроса: по категории (без категории — в конце), названию, ключу. */
const byDefaultOrder = (left: PaletteEntry, right: PaletteEntry): number => {
  const leftCategory = lower(left.command.category);
  const rightCategory = lower(right.command.category);
  if ((leftCategory === '') !== (rightCategory === '')) {
    return leftCategory === '' ? 1 : -1;
  }
  return (
    compare(leftCategory, rightCategory) ||
    compare(lower(left.command.title), lower(right.command.title)) ||
    compare(left.key, right.key)
  );
};

const TITLE_PREFIX = 0;
const TITLE_WORD = 1;
const TITLE_PART = 2;
const CATEGORY_PART = 3;
const EXTENSION_PART = 4;

/** Насколько хорошо слово запроса совпало с командой; `null` — не совпало. */
const scoreTerm = (command: CommandContributionDto, term: string) => {
  const title = lower(command.title);
  if (title.startsWith(term)) return TITLE_PREFIX;
  if (title.includes(` ${term}`)) return TITLE_WORD;
  if (title.includes(term)) return TITLE_PART;
  if (lower(command.category).includes(term)) return CATEGORY_PART;
  if (lower(command.extensionId).includes(term)) return EXTENSION_PART;
  return null;
};

/**
 * Строки палитры: команды с `palette: true`, которые содержат каждое слово
 * запроса (без учёта регистра) в названии, категории или id расширения.
 * Без запроса — по категории и названию; с запросом — по близости совпадения,
 * при равенстве — в том же порядке.
 */
export const filterCommands = (
  commands: readonly CommandContributionDto[],
  query: string,
): PaletteEntry[] => {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored: { entry: PaletteEntry; score: number }[] = [];
  for (const command of commands) {
    if (!command.palette) continue;
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
    if (matches) {
      scored.push({ entry: { key: commandKey(command), command }, score });
    }
  }
  return scored
    .sort(
      (left, right) =>
        left.score - right.score || byDefaultOrder(left.entry, right.entry),
    )
    .map(({ entry }) => entry);
};
