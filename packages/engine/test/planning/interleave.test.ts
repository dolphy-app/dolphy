/**
 * T-54: интерливинг — полнота на малых наборах (перебор перестановок),
 * дневные планы 20–40 позиций, параметры `maxSameCourseRun` /
 * `minTagDistance` (порт `spike/fire-plan/test/planner.test.ts`, блок
 * `interleaving`).
 */
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { interleave } from '../../src/planning/interleave.ts';
import type {
  InterleaveEntry,
  InterleaveOptions,
} from '../../src/planning/interleave.ts';
import { createPlanner } from '../../src/planning/planner.ts';
import { createSeededRng } from '../../src/planning/seeded-random.ts';
import { PLANNER_OPTIONS, planStateOf, world } from './helpers.ts';

const shareTag = (a: InterleaveEntry, b: InterleaveEntry) =>
  a.tags.some((tag) => b.tags.includes(tag));

const courseRunsOk = (
  sequence: readonly InterleaveEntry[],
  maxSameCourseRun: number,
) => {
  let run = 0;
  for (let i = 0; i < sequence.length; i++) {
    const same =
      i > 0 &&
      (sequence[i] as InterleaveEntry).course ===
        (sequence[i - 1] as InterleaveEntry).course;
    run = same ? run + 1 : 1;
    if (run > maxSameCourseRun) return false;
  }
  return true;
};

const tagsOk = (
  sequence: readonly InterleaveEntry[],
  minTagDistance: number,
) => {
  for (let i = 0; i < sequence.length; i++) {
    for (let k = 1; k < minTagDistance && i - k >= 0; k++) {
      if (
        shareTag(
          sequence[i] as InterleaveEntry,
          sequence[i - k] as InterleaveEntry,
        )
      ) {
        return false;
      }
    }
  }
  return true;
};

const valid = (sequence: readonly InterleaveEntry[], o: InterleaveOptions) =>
  courseRunsOk(sequence, o.maxSameCourseRun) &&
  tagsOk(sequence, o.minTagDistance);

const permutations = <T>(items: readonly T[]): T[][] =>
  items.length <= 1
    ? [[...items]]
    : items.flatMap((item, i) =>
        permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(
          (rest) => [item, ...rest],
        ),
      );

const at = <T>(items: readonly T[], indexes: readonly number[]): T[] =>
  indexes.map((i) => items[i] as T);

const entryArb = fc.record({
  course: fc.integer({ min: 0, max: 2 }),
  tags: fc.uniqueArray(fc.constantFrom('t0', 't1', 't2', 't3'), {
    maxLength: 2,
  }),
});
const optionsArb = fc.record({
  maxSameCourseRun: fc.integer({ min: 1, max: 3 }),
  minTagDistance: fc.integer({ min: 1, max: 3 }),
});

describe('small sets against brute force over all permutations', () => {
  test('whenever ANY permutation satisfies both rules interleave finds one; otherwise ok is false and the fallback is honest', () => {
    let feasible = 0;
    let infeasible = 0;
    let courseOnly = 0;
    fc.assert(
      fc.property(
        fc.array(entryArb, { minLength: 2, maxLength: 7 }),
        optionsArb,
        fc.integer({ min: 1, max: 1e6 }),
        (entries, options, seed) => {
          const result = interleave(entries, options, createSeededRng(seed));
          expect([...result.order].sort((a, b) => a - b)).toEqual(
            entries.map((_, i) => i),
          );
          const arranged = at(entries, result.order);
          const indexes = entries.map((_, i) => i);
          const all = permutations(indexes).map((order) => at(entries, order));
          if (all.some((sequence) => valid(sequence, options))) {
            feasible++;
            expect(result.ok).toBe(true);
            expect(valid(arranged, options)).toBe(true);
            return;
          }
          infeasible++;
          expect(result.ok).toBe(false);
          // ослабление: хотя бы серии курса, если это достижимо; иначе — любая
          // перестановка (проверена выше), правила курса не гарантируются
          const coursesOnly = all.some((sequence) =>
            courseRunsOk(sequence, options.maxSameCourseRun),
          );
          if (coursesOnly) {
            courseOnly++;
            expect(courseRunsOk(arranged, options.maxSameCourseRun)).toBe(true);
          }
        },
      ),
      { seed: 21, numRuns: 400 },
    );
    console.log(
      `interleave brute force: feasible ${feasible}, infeasible ${infeasible} (course-only relaxation ${courseOnly})`,
    );
    expect(feasible).toBeGreaterThan(50);
    expect(infeasible).toBeGreaterThan(5);
    expect(courseOnly).toBeGreaterThan(0);
  });

  test('deterministic for an equal rng stream; consumes n keys for n >= 2 and none otherwise', () => {
    const entries: InterleaveEntry[] = [
      { course: 0, tags: ['a'] },
      { course: 0, tags: ['b'] },
      { course: 1, tags: ['a'] },
      { course: 1, tags: ['c'] },
      { course: 2, tags: [] },
    ];
    const options = { maxSameCourseRun: 2, minTagDistance: 2 };
    const a = interleave(entries, options, createSeededRng(9));
    const b = interleave(entries, options, createSeededRng(9));
    expect(b).toEqual(a);
    let draws = 0;
    const counting = {
      random: () => {
        draws++;
        return 0.5;
      },
    };
    interleave(entries, options, counting);
    expect(draws).toBe(entries.length);
    draws = 0;
    expect(interleave([], options, counting)).toEqual({ order: [], ok: true });
    expect(interleave(entries.slice(0, 1), options, counting)).toEqual({
      order: [0],
      ok: true,
    });
    expect(draws).toBe(0);
  });
});

describe('rule parameters', () => {
  const entry = (course: number, ...tags: string[]): InterleaveEntry => ({
    course,
    tags,
  });

  test('maxSameCourseRun bounds the series of one course', () => {
    const entries = [0, 0, 0, 0, 1, 1, 1, 1].map((course) => entry(course));
    for (const maxSameCourseRun of [1, 2, 3, 4]) {
      const result = interleave(
        entries,
        { maxSameCourseRun, minTagDistance: 1 },
        createSeededRng(3),
      );
      expect(result.ok).toBe(true);
      expect(courseRunsOk(at(entries, result.order), maxSameCourseRun)).toBe(
        true,
      );
    }
    // 3 из одного курса и один другой при максимуме 1 — невыполнимо
    const lopsided = [entry(0), entry(0), entry(0), entry(1)];
    const result = interleave(
      lopsided,
      { maxSameCourseRun: 1, minTagDistance: 1 },
      createSeededRng(3),
    );
    expect(result.ok).toBe(false);
    expect([...result.order].sort()).toEqual([0, 1, 2, 3]);
    // а при максимуме 2 — выполнимо
    const relaxed = interleave(
      lopsided,
      { maxSameCourseRun: 2, minTagDistance: 1 },
      createSeededRng(3),
    );
    expect(relaxed.ok).toBe(true);
    expect(courseRunsOk(at(lopsided, relaxed.order), 2)).toBe(true);
  });

  test('minTagDistance spaces equal tags; 1 means no constraint', () => {
    const entries = [
      entry(0, 'x'),
      entry(1, 'x'),
      entry(0, 'y'),
      entry(1, 'y'),
      entry(0, 'z'),
      entry(1, 'z'),
    ];
    for (const minTagDistance of [2, 3]) {
      const result = interleave(
        entries,
        { maxSameCourseRun: 6, minTagDistance },
        createSeededRng(5),
      );
      expect(result.ok).toBe(true);
      expect(tagsOk(at(entries, result.order), minTagDistance)).toBe(true);
    }
    // расстояние 4 между парами из трёх тегов при 6 позициях невозможно
    const impossible = interleave(
      entries,
      { maxSameCourseRun: 6, minTagDistance: 4 },
      createSeededRng(5),
    );
    expect(impossible.ok).toBe(false);
    // один общий тег у всех и расстояние ≥ 2: невыполнимо; расстояние 1: любой порядок
    const same = [entry(0, 'x'), entry(1, 'x'), entry(2, 'x')];
    expect(
      interleave(
        same,
        { maxSameCourseRun: 3, minTagDistance: 2 },
        createSeededRng(1),
      ).ok,
    ).toBe(false);
    expect(
      interleave(
        same,
        { maxSameCourseRun: 3, minTagDistance: 1 },
        createSeededRng(1),
      ).ok,
    ).toBe(true);
  });

  test('when both rules cannot be met the course rule is kept if it can be', () => {
    // теги мешают (все 'x'), курсы позволяют чередование
    const entries = [0, 0, 1, 1].map((course) => ({ course, tags: ['x'] }));
    const result = interleave(
      entries,
      { maxSameCourseRun: 1, minTagDistance: 2 },
      createSeededRng(2),
    );
    expect(result.ok).toBe(false);
    expect(courseRunsOk(at(entries, result.order), 1)).toBe(true);
  });
});

describe('daily plans of 20-40 items', () => {
  test('whenever the planner reports interleaveOk the rules hold; the ok share is measured, not pinned', () => {
    let ok = 0;
    let total = 0;
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1e6 }),
        fc.integer({ min: 20, max: 40 }),
        (seed, maxItems) => {
          const { graph, credit, index, now } = world(seed, 'trane', 60, 300);
          const planner = createPlanner(graph, credit, PLANNER_OPTIONS);
          const detail = planner.planDayDetailed(
            planStateOf(graph, index, now),
            { maxItems, rng: createSeededRng(seed) },
          );
          total++;
          const entries = detail.items.map(({ exerciseId }) => {
            const lesson = graph.exerciseLesson[
              graph.exerciseIndex.get(exerciseId) as number
            ] as number;
            return {
              course: graph.lessonCourse[lesson] as number,
              tags: graph.lessonTags[lesson] as readonly string[],
            };
          });
          expect(detail.items.length).toBeLessThanOrEqual(maxItems);
          if (detail.interleaveOk) {
            ok++;
            expect(valid(entries, PLANNER_OPTIONS)).toBe(true);
          }
        },
      ),
      { seed: 22, numRuns: 60 },
    );
    console.log(`interleave ok share on daily plans: ${ok}/${total}`);
    expect(total).toBe(60);
  });
});
