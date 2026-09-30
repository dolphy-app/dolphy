/**
 * Порт модульных тестов `scheduler.rs` (mod test, :1203-1524, 13 тестов):
 * `deduplicate_candidates`, `select_candidates` ×7, `extend_candidates` ×5.
 *
 * Отличия от Rust: `rng` инжектируется (Rust — `rand::rng()`), поэтому тесты
 * с выборкой проверяют длину и подмножество, а не порядок; `f32`-двойник
 * (`precision: 'f32'`) прогоняется по тем же таблицам, что и `f64`.
 * Дополнительно — число обращений к `Rng` (не более одного `shuffle`,
 * ни одного при «все кандидаты»).
 */
import { describe, expect, it } from 'vitest';
import type { SchedulerOptionsDto } from '@dolphy-app/engine-contract';
import {
  DEFAULT_SCHEDULER_OPTIONS,
  createCandidate,
  deduplicateCandidates,
  extendCandidates,
  selectCandidates,
} from '../../src/scheduler/index.ts';
import type { Candidate } from '../../src/scheduler/index.ts';
import type { Precision } from '../../src/scoring/index.ts';
import { createCountingRng } from './helpers/counting-rng.ts';

type Passing = SchedulerOptionsDto['passingScore'];

const PASSING: Passing = { minScore: 3.0, minFraction: 0.2, minAvgTrials: 2.0 };
const PRECISIONS: readonly Precision[] = ['f64', 'f32'];

const candidate = (id: number, exerciseScore: number, depth: number) =>
  createCandidate({
    exerciseId: `exercise-${id}`,
    lessonId: 'lesson',
    courseId: 'course',
    depth,
    exerciseScore,
  });

const candidateWithLesson = (id: number, lessonId: string) =>
  createCandidate({
    exerciseId: `exercise-${id}`,
    lessonId,
    courseId: 'course',
    depth: 1,
  });

/** Аналог `select` Rust: `numCandidates` кандидатов с оценкой 0. */
const select = (
  lessonScore: number,
  numCandidates: number,
  passing: Passing,
  precision: Precision = 'f64',
) => {
  const candidates = Array.from({ length: numCandidates }, (_, index) =>
    candidate(index, 0.0, 1.0),
  );
  const counting = createCountingRng(7);
  const selected = selectCandidates(
    candidates,
    lessonScore,
    passing,
    counting.rng,
    precision,
  );
  return { candidates, selected, counting };
};

const withMaxLessons = (max: number) => ({
  masteryWindows: DEFAULT_SCHEDULER_OPTIONS.masteryWindows,
  maxLessonsInProgress: max,
});

describe('deduplicateCandidates', () => {
  it('deduplicate_candidates: первый выигрывает, порядок сохраняется', () => {
    const candidates = [
      candidate(2, 4.0, 1.0),
      candidate(1, 3.0, 2.0),
      candidate(2, 1.0, 9.0),
    ];
    const actual = deduplicateCandidates(candidates).map((c) => [
      c.exerciseId,
      c.exerciseScore,
      c.depth,
    ]);
    expect(actual).toEqual([
      ['exercise-2', 4.0, 1.0],
      ['exercise-1', 3.0, 2.0],
    ]);
  });
});

describe.each(PRECISIONS)('selectCandidates (%s)', (precision) => {
  it('select_candidates_empty: пусто → пусто, без обращений к rng', () => {
    const counting = createCountingRng();
    const selected = selectCandidates(
      [],
      0.0,
      DEFAULT_SCHEDULER_OPTIONS.passingScore,
      counting.rng,
      precision,
    );
    expect(selected).toEqual([]);
    expect(counting.total()).toBe(0);
  });

  it('select_candidates_below_minimum_score: оценка ниже порога → все', () => {
    const { candidates, selected, counting } = select(
      2.0,
      5,
      { minScore: 3.0, minFraction: 0.2, minAvgTrials: 2.0 },
      precision,
    );
    expect(selected).toEqual(candidates);
    expect(counting.total()).toBe(0);
  });

  it('select_candidates_below_minimum_score_with_zero_fraction: то же при minFraction 0', () => {
    const { candidates, selected, counting } = select(
      2.0,
      5,
      { minScore: 3.0, minFraction: 0.0, minAvgTrials: 2.0 },
      precision,
    );
    expect(selected).toEqual(candidates);
    expect(counting.total()).toBe(0);
  });

  it('select_candidates_minimum_score_guarantees_one: на пороге остаётся хотя бы один', () => {
    const { candidates, selected, counting } = select(
      3.0,
      2,
      PASSING,
      precision,
    );
    expect(selected).toHaveLength(1);
    expect(candidates).toContain(selected[0]);
    expect(counting.calls.shuffle).toBe(1);
  });

  it('select_candidates_partial_selection: доля по формуле, floor', () => {
    const { candidates, selected, counting } = select(
      3.8,
      10,
      PASSING,
      precision,
    );
    expect(selected).toHaveLength(8);
    expect(new Set(selected).size).toBe(8);
    for (const item of selected) expect(candidates).toContain(item);
    expect(counting.calls.shuffle).toBe(1);
    expect(counting.total()).toBe(1);
  });

  it('select_candidates_always_keep_one_when_fraction_positive: доля > 0, floor 0 → один', () => {
    const { selected } = select(
      3.01,
      2,
      { minScore: 3.0, minFraction: 0.0, minAvgTrials: 2.0 },
      precision,
    );
    expect(selected).toHaveLength(1);
  });

  it('select_candidates_full_selection: оценка ≥ 4.0 → все, без rng', () => {
    const atMax = select(5.0, 11, PASSING, precision);
    expect(atMax.selected).toEqual(atMax.candidates);
    expect(atMax.counting.total()).toBe(0);
    const atThreshold = select(4.0, 11, PASSING, precision);
    expect(atThreshold.selected).toEqual(atThreshold.candidates);
    expect(atThreshold.counting.total()).toBe(0);
  });
});

describe('selectCandidates: доля между minScore и 4.0', () => {
  // доля = minFraction + (score − minScore) / (4 − minScore) · (1 − minFraction)
  it.each([
    { score: 3.25, count: 10, expected: 4 },
    { score: 3.5, count: 25, expected: 15 },
    { score: 3.75, count: 20, expected: 16 },
    { score: 3.99, count: 10, expected: 9 },
  ])('оценка $score, $count кандидатов → $expected', (row) => {
    const { selected } = select(row.score, row.count, PASSING);
    expect(selected).toHaveLength(row.expected);
  });

  it('входной массив не меняется (перемешивается копия)', () => {
    const { candidates } = select(3.8, 10, PASSING);
    expect(candidates.map((c) => c.exerciseId)).toEqual(
      Array.from({ length: 10 }, (_, index) => `exercise-${index}`),
    );
  });
});

describe('extendCandidates', () => {
  it('extend_candidates_within_limit: уроки в пределах лимита добавляются', () => {
    const options = withMaxLessons(3);
    const all: Candidate[] = [];
    const inProgress = new Set<string>();
    // оценки ниже верхней границы окна target — «в процессе»
    extendCandidates(
      all,
      [candidateWithLesson(0, 'lesson-a')],
      'lesson-a',
      1.0,
      inProgress,
      options,
    );
    extendCandidates(
      all,
      [candidateWithLesson(1, 'lesson-b')],
      'lesson-b',
      1.0,
      inProgress,
      options,
    );
    expect(all).toHaveLength(2);
    expect(inProgress.size).toBe(2);
  });

  it('extend_candidates_exceeds_limit: сверх лимита кандидаты отбрасываются', () => {
    const options = withMaxLessons(2);
    const all: Candidate[] = [];
    const inProgress = new Set<string>();
    for (const lesson of ['lesson-a', 'lesson-b']) {
      extendCandidates(
        all,
        [candidateWithLesson(0, lesson)],
        lesson,
        1.0,
        inProgress,
        options,
      );
    }
    extendCandidates(
      all,
      [candidateWithLesson(2, 'lesson-c')],
      'lesson-c',
      1.0,
      inProgress,
      options,
    );
    expect(all).toHaveLength(2);
    expect(inProgress.size).toBe(2);
    expect(inProgress.has('lesson-c')).toBe(false);
  });

  it('extend_candidates_already_tracked_lesson: учтённый урок продолжает давать кандидатов', () => {
    const options = withMaxLessons(1);
    const all: Candidate[] = [];
    const inProgress = new Set<string>();
    for (const id of [0, 1]) {
      extendCandidates(
        all,
        [candidateWithLesson(id, 'lesson-a')],
        'lesson-a',
        1.0,
        inProgress,
        options,
      );
    }
    expect(all).toHaveLength(2);
    expect(inProgress.size).toBe(1);
  });

  it('extend_candidates_passed_lessons_bypass_limit: оценка выше окна target обходит лимит', () => {
    const options = withMaxLessons(1);
    const all: Candidate[] = [];
    const inProgress = new Set<string>();
    extendCandidates(
      all,
      [candidateWithLesson(0, 'lesson-a')],
      'lesson-a',
      1.0,
      inProgress,
      options,
    );
    extendCandidates(
      all,
      [candidateWithLesson(1, 'lesson-b')],
      'lesson-b',
      3.0,
      inProgress,
      options,
    );
    expect(all).toHaveLength(2);
    expect(inProgress.size).toBe(1);
    expect(inProgress.has('lesson-b')).toBe(false);
  });

  it('extend_candidates_no_score_counts_as_in_progress: null = «в процессе»', () => {
    const options = withMaxLessons(1);
    const all: Candidate[] = [];
    const inProgress = new Set<string>();
    extendCandidates(
      all,
      [candidateWithLesson(0, 'lesson-a')],
      'lesson-a',
      null,
      inProgress,
      options,
    );
    extendCandidates(
      all,
      [candidateWithLesson(1, 'lesson-b')],
      'lesson-b',
      null,
      inProgress,
      options,
    );
    expect(all).toHaveLength(1);
    expect(inProgress.size).toBe(1);
  });

  it('граница окна target включена в «в процессе»; пустой список слот не занимает', () => {
    const options = withMaxLessons(1);
    const upper = options.masteryWindows.target.range[1];
    const all: Candidate[] = [];
    const inProgress = new Set<string>();
    extendCandidates(all, [], 'lesson-empty', null, inProgress, options);
    expect(inProgress.size).toBe(0);
    extendCandidates(
      all,
      [candidateWithLesson(0, 'lesson-a')],
      'lesson-a',
      upper,
      inProgress,
      options,
    );
    extendCandidates(
      all,
      [candidateWithLesson(1, 'lesson-b')],
      'lesson-b',
      upper,
      inProgress,
      options,
    );
    expect(all.map((c) => c.lessonId)).toEqual(['lesson-a']);
    expect([...inProgress]).toEqual(['lesson-a']);
  });
});
