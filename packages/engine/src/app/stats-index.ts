import { dailyOf, localDayOf, streakOf } from '../domain/learning-stats.ts';
import type {
  DailyResult,
  DayCounts,
  StreakResult,
} from '../domain/learning-stats.ts';
import type { Clock, EventStore } from '../ports/index.ts';
import { PASSING_GRADE_MIN } from '../scheduler/session-state.ts';

/**
 * Индекс статистики для расширений с `learning.stats`: «местная дата × курс →
 * { попыток, верных }» по всем попыткам журнала. Это история, а не прогресс:
 * `progress_reset` в счёт не идёт, попытки со сброшенных упражнений остаются.
 * Строится при первом обращении одним проходом по журналу и сбрасывается при
 * новых записях (`invalidate`) и смене часового пояса процесса.
 */
export interface StatsIndex {
  /** Журнал изменился: при следующем обращении индекс строится заново. */
  invalidate(): void;
  /** `courseId` не задан — все курсы; неизвестный курс — нули. */
  streak(courseId?: string): Promise<StreakResult>;
  /** `from`/`to` — номера дней `parseStatsDate`, диапазон уже проверен. */
  daily(from: number, to: number, courseId?: string): Promise<DailyResult[]>;
}

export interface StatsIndexDeps {
  eventStore: Pick<EventStore, 'readAll'>;
  clock: Clock;
  /** Часовой пояс пользователя (IANA); читается при каждом обращении. */
  timeZone(): string;
}

interface Built {
  timeZone: string;
  total: Map<number, DayCounts>;
  byCourse: Map<string, Map<number, DayCounts>>;
}

/** Курс — префикс `<курс>::` идентификатора упражнения; без разделителя курса нет. */
const courseOf = (exerciseId: string): string | null => {
  const end = exerciseId.indexOf('::');
  return end < 0 ? null : exerciseId.slice(0, end);
};

const count = (
  days: Map<number, DayCounts>,
  day: number,
  correct: boolean,
): void => {
  const counts = days.get(day) ?? { attempts: 0, correct: 0 };
  counts.attempts += 1;
  if (correct) counts.correct += 1;
  days.set(day, counts);
};

const EMPTY: ReadonlyMap<number, DayCounts> = new Map();

export const createStatsIndex = (deps: StatsIndexDeps): StatsIndex => {
  let generation = 0;
  let built: Built | null = null;
  let building: { timeZone: string; promise: Promise<Built> } | null = null;

  const build = async (timeZone: string): Promise<Built> => {
    for (;;) {
      const started = generation;
      const next: Built = { timeZone, total: new Map(), byCourse: new Map() };
      for await (const entry of deps.eventStore.readAll()) {
        if (entry.kind !== 'attempt') continue;
        const { exerciseId, grade, at } = entry;
        const day = localDayOf(at, timeZone);
        const correct = grade >= PASSING_GRADE_MIN;
        count(next.total, day, correct);
        const course = courseOf(exerciseId);
        if (course === null) continue;
        let days = next.byCourse.get(course);
        if (days === undefined) {
          days = new Map();
          next.byCourse.set(course, days);
        }
        count(days, day, correct);
      }
      // запись пришла во время прохода: журнал мог измениться, проходим заново
      if (started === generation) return next;
    }
  };

  const ready = async (): Promise<Built> => {
    const timeZone = deps.timeZone();
    if (built !== null && built.timeZone === timeZone) return built;
    if (building === null || building.timeZone !== timeZone) {
      const promise = build(timeZone).then(
        (result) => {
          if (building?.promise === promise) {
            built = result;
            building = null;
          }
          return result;
        },
        (error: unknown) => {
          if (building?.promise === promise) building = null;
          throw error;
        },
      );
      building = { timeZone, promise };
    }
    return building.promise;
  };

  const daysOf = (index: Built, courseId: string | undefined) =>
    courseId === undefined
      ? index.total
      : (index.byCourse.get(courseId) ?? EMPTY);

  return {
    invalidate() {
      generation += 1;
      built = null;
      building = null;
    },
    async streak(courseId) {
      const index = await ready();
      const today = localDayOf(deps.clock.now(), index.timeZone);
      return streakOf(daysOf(index, courseId), today);
    },
    async daily(from, to, courseId) {
      const index = await ready();
      return dailyOf(daysOf(index, courseId), from, to);
    },
  };
};
