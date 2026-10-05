/**
 * Статистика обучения для расширений (`learning.stats`): чистая арифметика
 * локальных дат. День — календарная дата в часовом поясе пользователя; для
 * счёта «подряд» и диапазонов даты превращаются в номера дней (дни от
 * 1970-01-01 по календарю), поэтому переход на летнее время и длина суток на
 * счёт не влияют.
 */

/** Предел `daily`: число дат диапазона, обе границы включены. */
export const STATS_DAILY_MAX_DAYS = 366;

const DAY_MS = 86_400_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DayCounts {
  attempts: number;
  correct: number;
}

export interface StreakResult {
  current: number;
  longest: number;
}

export interface DailyResult {
  date: string;
  attempts: number;
  correct: number;
  /** `correct / attempts`; `null` без попыток. */
  accuracy: number | null;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

const formatterOf = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
};

/** Номер дня (от 1970-01-01) календарной даты `y-m-d`. */
const dayNumberOf = (year: number, month: number, day: number): number => {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return Math.floor(date.getTime() / DAY_MS);
};

/** Номер местного дня момента `at` (мс) в часовом поясе; недопустимый пояс бросает `RangeError`. */
export const localDayOf = (at: number, timeZone: string): number => {
  let year = 0;
  let month = 0;
  let day = 0;
  for (const part of formatterOf(timeZone).formatToParts(at)) {
    if (part.type === 'year') year = Number(part.value);
    else if (part.type === 'month') month = Number(part.value);
    else if (part.type === 'day') day = Number(part.value);
  }
  return dayNumberOf(year, month, day);
};

/** Номер дня → `YYYY-MM-DD`. */
export const formatStatsDate = (dayNumber: number): string => {
  const date = new Date(dayNumber * DAY_MS);
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/** `YYYY-MM-DD` → номер дня; `null` — не дата или несуществующая (`2025-02-30`). */
export const parseStatsDate = (value: unknown): number | null => {
  if (typeof value !== 'string') return null;
  const match = DATE_PATTERN.exec(value);
  if (match === null) return null;
  const [year, month, day] = [match[1], match[2], match[3]].map(Number) as [
    number,
    number,
    number,
  ];
  const number = dayNumberOf(year, month, day);
  return formatStatsDate(number) === value ? number : null;
};

/**
 * Серия по дням с попытками. `current` — подряд идущие дни, оканчивающиеся
 * сегодня или (пока сегодня попыток нет) вчера; дни после `today` в неё не
 * входят. `longest` — самая длинная серия за всю историю.
 */
export const streakOf = (
  days: ReadonlyMap<number, DayCounts>,
  today: number,
): StreakResult => {
  const sorted = [...days.keys()].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  let previous = Number.NaN;
  for (const day of sorted) {
    run = day === previous + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }
  let cursor = days.has(today) ? today : today - 1;
  let current = 0;
  while (days.has(cursor)) {
    current += 1;
    cursor -= 1;
  }
  return { current, longest };
};

/** Запись на каждую дату `[from, to]` (номера дней); без попыток — нули и `accuracy: null`. */
export const dailyOf = (
  days: ReadonlyMap<number, DayCounts>,
  from: number,
  to: number,
): DailyResult[] => {
  const result: DailyResult[] = [];
  for (let day = from; day <= to; day += 1) {
    const { attempts, correct } = days.get(day) ?? { attempts: 0, correct: 0 };
    result.push({
      date: formatStatsDate(day),
      attempts,
      correct,
      accuracy: attempts === 0 ? null : correct / attempts,
    });
  }
  return result;
};
