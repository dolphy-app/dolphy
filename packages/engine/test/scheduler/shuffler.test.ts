/**
 * Порт модульных тестов `scheduler/shuffler.rs` (mod tests, :86-268, 7
 * тестов) и пробелов спеки: число и места обращений к `Rng`.
 *
 * Отличия от Rust: `Rng` инжектируется — тесты, где Rust полагался на 20
 * прогонов `rand::rng()`, идут по сидам `createSeededRng`, а порядок групп
 * дополнительно проверяется детерминированно подменой `random()`
 * (последовательность заданных значений).
 */
import { createSeededRng } from '@spirula-app/testkit';
import { describe, expect, it } from 'vitest';
import type { Rng } from '../../src/ports/index.ts';
import {
  DEFAULT_SCHEDULER_OPTIONS,
  MAX_GROUP_SIZE,
  NEW_GROUP_KEY_MAX,
  NEW_GROUP_KEY_MIN,
  OTHER_GROUP_KEY_MAX,
  OTHER_GROUP_KEY_MIN,
  createCandidate,
  groupSortKey,
  shuffleCandidates,
} from '../../src/scheduler/index.ts';
import type { Candidate } from '../../src/scheduler/index.ts';
import { createCountingRng } from './helpers/counting-rng.ts';

const OPTIONS = DEFAULT_SCHEDULER_OPTIONS;
const THRESHOLD = OPTIONS.masteryWindows.target.range[1];
const SEEDS = Array.from({ length: 20 }, (_, index) => index + 1);

const candidate = (
  courseId: string,
  exerciseId: string,
  exerciseScore: number,
) =>
  createCandidate({
    exerciseId,
    lessonId: 'lesson_1',
    courseId,
    exerciseScore,
  });

const isContiguous = (
  result: readonly Candidate[],
  predicate: (c: Candidate) => boolean,
) => {
  const positions = result.flatMap((c, index) => (predicate(c) ? [index] : []));
  if (positions.length === 0) return true;
  return (
    (positions[positions.length - 1] ?? 0) - (positions[0] ?? 0) ===
    positions.length - 1
  );
};

/** Настоящий сидируемый `Rng`, но `random()` отдаёт заданные значения по кругу. */
const withRandomSequence = (values: readonly number[], seed = 1): Rng => {
  let index = 0;
  return {
    ...createSeededRng(seed),
    random: () => {
      const value = values[index % values.length] ?? 0;
      index += 1;
      return value;
    },
  };
};

const ids = (candidates: readonly Candidate[]) =>
  candidates.map((c) => c.exerciseId);

describe('shuffleCandidates', () => {
  it('empty_candidates: пусто → пусто, без обращений к rng', () => {
    const counting = createCountingRng();
    expect(shuffleCandidates([], OPTIONS, counting.rng)).toEqual([]);
    expect(counting.total()).toBe(0);
  });

  it('preserves_all_candidates: мультимножество сохраняется', () => {
    const candidates = [
      candidate('c1', 'e1', 1.0),
      candidate('c1', 'e2', 1.5),
      candidate('c2', 'e3', 0.5),
      candidate('c3', 'e4', 4.0),
      candidate('c3', 'e5', 3.5),
    ];
    for (const seed of SEEDS) {
      const result = shuffleCandidates(
        candidates,
        OPTIONS,
        createSeededRng(seed),
      );
      expect(result).toHaveLength(5);
      expect(ids(result).sort()).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
    }
  });

  it('входной массив не меняется', () => {
    const candidates = [
      candidate('c2', 'e1', 1.0),
      candidate('c1', 'e2', 1.0),
      candidate('c1', 'e3', 4.0),
    ];
    const before = ids(candidates);
    shuffleCandidates(candidates, OPTIONS, createSeededRng(1));
    expect(ids(candidates)).toEqual(before);
  });

  it('low_candidates_grouped_by_course: низкие одного курса идут подряд', () => {
    const candidates = [
      candidate('c1', 'e1', 1.0),
      candidate('c2', 'e2', 0.5),
      candidate('c1', 'e3', 2.0),
      candidate('c2', 'e4', 1.5),
      candidate('c1', 'e5', 0.0),
    ];
    for (const seed of SEEDS) {
      const result = shuffleCandidates(
        candidates,
        OPTIONS,
        createSeededRng(seed),
      );
      expect(isContiguous(result, (c) => c.courseId === 'c1')).toBe(true);
      expect(isContiguous(result, (c) => c.courseId === 'c2')).toBe(true);
    }
  });

  it('mixed_low_and_high_candidates: низкие сгруппированы, размер сохранён', () => {
    const candidates = [
      candidate('c1', 'e1', 1.0),
      candidate('c1', 'e2', 2.0),
      candidate('c2', 'e3', 0.5),
      candidate('c1', 'e4', 4.0),
      candidate('c2', 'e5', 3.0),
    ];
    for (const seed of SEEDS) {
      const result = shuffleCandidates(
        candidates,
        OPTIONS,
        createSeededRng(seed),
      );
      expect(result).toHaveLength(5);
      expect(
        isContiguous(
          result,
          (c) => c.courseId === 'c1' && c.exerciseScore <= THRESHOLD,
        ),
      ).toBe(true);
      expect(
        isContiguous(
          result,
          (c) => c.courseId === 'c2' && c.exerciseScore <= THRESHOLD,
        ),
      ).toBe(true);
    }
  });

  describe('threshold_boundary', () => {
    it('оценка ровно на границе окна target — «низкая», курсы подряд при любом rng', () => {
      const candidates = [
        candidate('c1', 'e1', THRESHOLD),
        candidate('c2', 'e3', THRESHOLD),
        candidate('c1', 'e2', THRESHOLD),
      ];
      for (const seed of SEEDS) {
        const result = shuffleCandidates(
          candidates,
          OPTIONS,
          createSeededRng(seed),
        );
        expect(isContiguous(result, (c) => c.courseId === 'c1')).toBe(true);
        expect(isContiguous(result, (c) => c.courseId === 'c2')).toBe(true);
      }
      // одинаковые ключи и устойчивая сортировка: «высокие» остались бы в исходном порядке
      const constant = withRandomSequence([0.5]);
      expect(ids(shuffleCandidates(candidates, OPTIONS, constant))).not.toEqual(
        ['e1', 'e3', 'e2'],
      );
    });

    it('чуть выше границы — «высокая»: каждый сам себе группа, порядок по ключам', () => {
      const high = THRESHOLD + 0.01;
      const candidates = [
        candidate('c1', 'e1', high),
        candidate('c2', 'e3', high),
        candidate('c1', 'e2', high),
      ];
      const constant = withRandomSequence([0.5]);
      expect(ids(shuffleCandidates(candidates, OPTIONS, constant))).toEqual([
        'e1',
        'e3',
        'e2',
      ]);
      // ключи убывают по порядку групп ⇒ порядок разворачивается
      const descending = withRandomSequence([0.9, 0.5, 0.1]);
      expect(ids(shuffleCandidates(candidates, OPTIONS, descending))).toEqual([
        'e2',
        'e3',
        'e1',
      ]);
    });
  });

  it('large_course_split_into_chunks: курс из 8 низких делится на группы ≤ 3', () => {
    const candidates: Candidate[] = Array.from({ length: 8 }, (_, i) =>
      candidate('c1', `e_c1_${i}`, 1.0),
    );
    for (let i = 0; i < 5; i++) {
      candidates.push(candidate(`c${i + 2}`, `e_other_${i}`, 1.0));
    }
    const longestRun = (result: readonly Candidate[]) => {
      let run = 0;
      let max = 0;
      for (const c of result) {
        run = c.courseId === 'c1' ? run + 1 : 0;
        max = Math.max(max, run);
      }
      return max;
    };
    let sawSplit = false;
    for (const seed of SEEDS) {
      const result = shuffleCandidates(
        candidates,
        OPTIONS,
        createSeededRng(seed),
      );
      expect(result).toHaveLength(13);
      if (longestRun(result) <= MAX_GROUP_SIZE) sawSplit = true;
    }
    expect(sawSplit).toBe(true);

    // детерминированно: ключи чанков курса c1 (3, 3, 2) разнесены ключами других курсов
    const separated = withRandomSequence([
      0.9, 0.1, 0.5, 0.3, 0.7, 0.2, 0.4, 0.6,
    ]);
    const result = shuffleCandidates(candidates, OPTIONS, separated);
    expect(result).toHaveLength(13);
    expect(longestRun(result)).toBeLessThanOrEqual(MAX_GROUP_SIZE);
    expect(ids(result).sort()).toEqual(ids(candidates).sort());
  });

  it('группы новых упражнений (средняя оценка ≤ 1.0) сдвинуты к концу', () => {
    const candidates = [
      candidate('c1', 'new-1', 0.5),
      candidate('c2', 'mid', 2.0),
      candidate('c3', 'top', 4.0),
    ];
    // одинаковое случайное значение: ключ новой группы 0.2 + 0.8r, прочих 0.8r
    const result = shuffleCandidates(
      candidates,
      OPTIONS,
      withRandomSequence([0.5]),
    );
    expect(ids(result)).toEqual(['mid', 'top', 'new-1']);
  });

  it('обращения к rng: shuffle на каждый курсовой блок низких, random на каждую группу', () => {
    const counting = createCountingRng();
    const candidates: Candidate[] = Array.from({ length: 8 }, (_, i) =>
      candidate('c1', `e_c1_${i}`, 1.0),
    );
    for (let i = 0; i < 5; i++) {
      candidates.push(candidate(`c${i + 2}`, `e_other_${i}`, 1.0));
    }
    candidates.push(
      candidate('c1', 'high-1', 4.0),
      candidate('c9', 'high-2', 3.0),
    );
    shuffleCandidates(candidates, OPTIONS, counting.rng);
    // блоки: c1 (8), c2..c6 по одному ⇒ 6 shuffle; группы: 3 + 5 + 2 высоких ⇒ 10 random
    expect(counting.calls.shuffle).toBe(6);
    expect(counting.calls.random).toBe(10);
    expect(counting.calls.range).toBe(0);
    expect(counting.calls.sample).toBe(0);
    expect(counting.calls.sampleWeighted).toBe(0);
  });
});

describe('groupSortKey', () => {
  it('group_sort_key: пустая группа — 0.0 без обращений к rng', () => {
    const counting = createCountingRng();
    expect(groupSortKey([], counting.rng)).toBe(0.0);
    expect(counting.total()).toBe(0);
  });

  it('group_sort_key: новая группа — ключ в [0.2, 1.0)', () => {
    const group = [candidate('c1', 'e1', 0.5), candidate('c1', 'e2', 0.1)];
    const rng = createSeededRng(9);
    for (let i = 0; i < 50; i++) {
      const key = groupSortKey(group, rng);
      expect(key).toBeGreaterThanOrEqual(NEW_GROUP_KEY_MIN);
      expect(key).toBeLessThan(NEW_GROUP_KEY_MAX);
    }
  });

  it('group_sort_key: прочие группы — ключ в [0.0, 0.8)', () => {
    const group = [candidate('c1', 'e1', 1.0), candidate('c1', 'e2', 2.0)];
    const rng = createSeededRng(9);
    for (let i = 0; i < 50; i++) {
      const key = groupSortKey(group, rng);
      expect(key).toBeGreaterThanOrEqual(OTHER_GROUP_KEY_MIN);
      expect(key).toBeLessThan(OTHER_GROUP_KEY_MAX);
    }
  });

  it('ровно одно обращение random() на непустую группу', () => {
    const counting = createCountingRng();
    groupSortKey([candidate('c1', 'e1', 3.0)], counting.rng);
    expect(counting.calls.random).toBe(1);
    expect(counting.total()).toBe(1);
  });

  it('граница средней оценки: ровно 1.0 — новая группа, выше — прочая', () => {
    const low = withRandomSequence([0]);
    const high = withRandomSequence([0]);
    // random() = 0 отдаёт нижнюю границу диапазона группы
    expect(groupSortKey([candidate('c', 'a', 1.0)], low)).toBe(
      NEW_GROUP_KEY_MIN,
    );
    expect(groupSortKey([candidate('c', 'a', 1.01)], high)).toBe(
      OTHER_GROUP_KEY_MIN,
    );
  });

  it('ключ линейно масштабирует random() внутри диапазона', () => {
    const rng = withRandomSequence([0.5]);
    expect(groupSortKey([candidate('c', 'a', 0.5)], rng)).toBeCloseTo(0.6, 10);
    expect(groupSortKey([candidate('c', 'a', 3.0)], rng)).toBeCloseTo(0.4, 10);
  });

  it('оценка группы — среднее по кандидатам', () => {
    // среднее (0.0 + 2.0) / 2 = 1.0 — новая группа
    const rng = withRandomSequence([0]);
    expect(
      groupSortKey([candidate('c', 'a', 0.0), candidate('c', 'b', 2.0)], rng),
    ).toBe(NEW_GROUP_KEY_MIN);
  });
});
