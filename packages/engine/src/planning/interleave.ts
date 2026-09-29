import type { Rng } from '../ports/index.ts';

export interface InterleaveEntry {
  readonly course: number;
  readonly tags: readonly string[];
}

export interface InterleaveOptions {
  /** Не более стольких подряд из одного курса. */
  readonly maxSameCourseRun: number;
  /** Позиции с общим тегом разнесены не менее чем на столько (1 — без ограничения). */
  readonly minTagDistance: number;
}

export interface InterleaveResult {
  /** Перестановка индексов входа. */
  readonly order: number[];
  /** `true`, если соблюдены оба правила; иначе — лучшее ослабление или вход как есть. */
  readonly ok: boolean;
}

/** Бюджет узлов поиска на один уровень ослабления. */
const NODE_BUDGET = 20_000;
/** Ветвление поиска: лучшие кандидаты на шаге. */
const BRANCH_LIMIT = 6;
const LEVELS = [2, 1, 0] as const;

/**
 * Интерливинг: DFS с бюджетом узлов. Кандидаты — сначала другой курс, чем у
 * предыдущего, затем курс с наибольшим остатком, затем случайный ключ `rng`.
 * Три уровня: курс и теги (`ok`), только курс, ничего. Детерминирован при
 * равном потоке `rng` (`n` ключей на каждый вызов при `n ≥ 2`).
 */
export const interleave = (
  entries: readonly InterleaveEntry[],
  options: InterleaveOptions,
  rng: Pick<Rng, 'random'>,
): InterleaveResult => {
  const n = entries.length;
  const identity = () => Array.from({ length: n }, (_, i) => i);
  if (n <= 1) return { order: identity(), ok: true };
  const keys = entries.map(() => rng.random());
  const { maxSameCourseRun, minTagDistance } = options;

  // необходимое условие правила курса: остальные элементы делят курс на серии
  // не длиннее `maxSameCourseRun`; нарушено — поиск заведомо безуспешен
  const perCourse = new Map<number, number>();
  for (const { course } of entries) {
    perCourse.set(course, (perCourse.get(course) ?? 0) + 1);
  }
  const courseRuleFeasible = [...perCourse.values()].every(
    (count) => count <= maxSameCourseRun * (n - count + 1),
  );

  for (const level of LEVELS) {
    if (level >= 1 && !courseRuleFeasible) continue;
    const remaining = new Map<number, number>();
    for (const { course } of entries) {
      remaining.set(course, (remaining.get(course) ?? 0) + 1);
    }
    const used = new Uint8Array(n);
    const sequence: number[] = [];
    let budget = NODE_BUDGET;

    const allowed = (index: number) => {
      const entry = entries[index] as InterleaveEntry;
      if (level >= 1) {
        let run = 0;
        for (
          let k = sequence.length - 1;
          k >= 0 && run < maxSameCourseRun;
          k--
        ) {
          if (
            (entries[sequence[k] as number] as InterleaveEntry).course !==
            entry.course
          )
            break;
          run++;
        }
        if (run >= maxSameCourseRun) return false;
      }
      if (level >= 2) {
        for (let k = 1; k < minTagDistance; k++) {
          const previous = sequence[sequence.length - k];
          if (previous === undefined) break;
          const other = entries[previous] as InterleaveEntry;
          if (other.tags.some((tag) => entry.tags.includes(tag))) return false;
        }
      }
      return true;
    };

    const search = (): boolean => {
      if (sequence.length === n) return true;
      if (budget-- <= 0) return false;
      const previousCourse =
        sequence.length > 0
          ? (
              entries[
                sequence[sequence.length - 1] as number
              ] as InterleaveEntry
            ).course
          : -1;
      const candidates: number[] = [];
      for (let i = 0; i < n; i++) {
        if (used[i] === 0 && allowed(i)) candidates.push(i);
      }
      const courseOf = (i: number) => (entries[i] as InterleaveEntry).course;
      candidates.sort((a, b) => {
        const sameA = courseOf(a) === previousCourse ? 1 : 0;
        const sameB = courseOf(b) === previousCourse ? 1 : 0;
        return (
          sameA - sameB ||
          (remaining.get(courseOf(b)) as number) -
            (remaining.get(courseOf(a)) as number) ||
          (keys[a] as number) - (keys[b] as number)
        );
      });
      for (const i of candidates.slice(0, BRANCH_LIMIT)) {
        const course = courseOf(i);
        used[i] = 1;
        sequence.push(i);
        remaining.set(course, (remaining.get(course) as number) - 1);
        if (search()) return true;
        remaining.set(course, (remaining.get(course) as number) + 1);
        sequence.pop();
        used[i] = 0;
        if (budget <= 0) return false;
      }
      return false;
    };

    if (search()) return { order: sequence, ok: level === 2 };
  }
  return { order: identity(), ok: false };
};
