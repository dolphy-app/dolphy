/**
 * Golden L1b: `FsrsScorer` (вариант H, `createTsFsrsMemoryModel`) против
 * (а) py-fsrs 6.3.2 — 600 историй `test/fixtures/reference.json`;
 * (б) настоящего Rust-адаптера `fsrs-scorer` (fsrs-rs 6.6.2, вариант `Hybrid`,
 * параметры по умолчанию) на тех же 5 919 входах, что и golden L1 —
 * `fsrs-scorer.jsonl`, генератор `golden-rs/src/bin/fsrs_golden.rs`.
 *
 * Допуски: Rust считает в f32, ts-fsrs — в f64 с округлением до 8 знаков на
 * каждом шаге. Измерено: value ≤ 9.6e-6, urgency ≤ 3.4e-6 (допуски с запасом
 * ×5), velocity — шум сокращения f32 МНК, как у golden L1 в f64; пороги
 * планировщика расходятся только на «ничьих» в пределах допуска.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MemoryModel } from '../../src/ports/index.ts';
import {
  type FsrsScorer,
  type RatingMapName,
  createFsrsScorer,
} from '../../src/scoring/index.ts';
import { createTsFsrsMemoryModel } from '../../src/scoring/memory-model.ts';
import { THRESHOLDS } from './golden-analysis.ts';
import {
  FSRS_GOLDEN_PATH,
  POWER_LAW_GOLDEN_PATH,
  loadGoldenCases,
} from './golden-cases.ts';

const memory: MemoryModel = createTsFsrsMemoryModel();
const scorers: Record<RatingMapName, FsrsScorer> = {
  runner: createFsrsScorer({ memory, ratingMap: 'runner' }),
  anki: createFsrsScorer({ memory, ratingMap: 'anki' }),
};

describe('golden L1b FsrsScorer vs py-fsrs 6.3.2', () => {
  interface ReferenceItem {
    times: number[]; // epoch, секунды
    grades: Array<1 | 2 | 3 | 4>;
    queries: number[];
    trace: Array<[stability: number, difficulty: number]>;
    r_frac: number[];
  }
  const reference = JSON.parse(
    readFileSync(
      new URL('../fixtures/reference.json', import.meta.url),
      'utf8',
    ),
  ) as { items: ReferenceItem[] };

  /** Рейтинг 1–4 → оценка Trane, которую `anki` возвращает в тот же рейтинг. */
  const SCORE_OF_RATING = [0, 1, 3, 4, 5];
  const historyOf = (item: ReferenceItem) =>
    item.times
      .map((time, i) => ({
        score: SCORE_OF_RATING[item.grades[i] as number] as number,
        timestamp: time * 1000,
      }))
      .reverse();

  it('replays the final memory state of all 600 histories', () => {
    for (const item of reference.items) {
      const replayed = scorers.anki.replay(historyOf(item));
      const [stability, difficulty] = item.trace.at(-1) as [number, number];
      const state = replayed?.state as {
        stability: number;
        difficulty: number;
      };
      expect(Math.abs(state.stability - stability) / stability).toBeLessThan(
        1e-6,
      );
      expect(Math.abs(state.difficulty - difficulty)).toBeLessThan(1e-6);
    }
  });

  it('urgency = 1 − R matches py-fsrs fractional-day R on 1 800 queries', () => {
    let queries = 0;
    for (const item of reference.items) {
      const history = historyOf(item);
      for (const [q, query] of item.queries.entries()) {
        const score = scorers.anki.score(
          'Procedural',
          history,
          [],
          query * 1000,
        );
        const expected = 1 - (item.r_frac[q] as number);
        expect(Math.abs(score.urgency - expected)).toBeLessThan(1e-7);
        queries++;
      }
    }
    expect(queries).toBe(1800);
  });
});

describe('golden L1b FsrsScorer vs Rust adapter (fsrs-rs 6.6.2, Hybrid)', () => {
  type Wire =
    | {
        ok: true;
        value: number | string;
        urgency: number | string;
        velocity: number | string | null;
      }
    | { ok: false; error: string };
  interface Line {
    id: number;
    rating_map: RatingMapName;
    expect: Wire;
  }

  const inputs = new Map(
    loadGoldenCases(POWER_LAW_GOLDEN_PATH).map((golden) => [golden.id, golden]),
  );
  const lines = readFileSync(FSRS_GOLDEN_PATH, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Line);

  /** JSON не кодирует NaN и бесконечности: fixture пишет их строками. */
  const decode = (value: number | string) =>
    typeof value === 'string' ? Number(value) : value;

  const VALUE_ATOL = 5e-5;
  const URGENCY_ATOL = 2e-5;
  const VELOCITY = { atol: 1e-2, rtol: 5e-5 };

  interface Compared {
    id: number;
    kind: string;
    ratingMap: RatingMapName;
    expected: { value: number; urgency: number; velocity: number | null };
    got: { value: number; urgency: number; velocity: number | null };
  }
  const compared: Compared[] = [];
  const errors: Array<{ id: number; expected: string; got: string | null }> =
    [];
  const statusMismatches: number[] = [];

  for (const line of lines) {
    const golden = inputs.get(line.id);
    if (!golden) throw new Error(`no input case ${line.id}`);
    const scorer = scorers[line.rating_map];
    let got = null;
    let gotError: string | null = null;
    try {
      got = scorer.score(golden.type, golden.trials, golden.deltas, golden.now);
    } catch (error) {
      gotError = error instanceof Error ? error.message : String(error);
    }
    if (line.expect.ok !== (got !== null)) {
      statusMismatches.push(line.id);
    } else if (!line.expect.ok) {
      errors.push({ id: line.id, expected: line.expect.error, got: gotError });
    } else if (got !== null) {
      compared.push({
        id: line.id,
        kind: golden.kind,
        ratingMap: line.rating_map,
        expected: {
          value: decode(line.expect.value),
          urgency: decode(line.expect.urgency),
          velocity:
            line.expect.velocity === null ? null : decode(line.expect.velocity),
        },
        got,
      });
    }
  }

  it('covers both rating maps on every golden input', () => {
    expect(lines).toHaveLength(inputs.size * 2);
    expect(compared.length + errors.length).toBe(lines.length);
    expect(compared.length).toBeGreaterThan(11_000);
  });

  it('agrees with Rust on which inputs are rejected', () => {
    expect(statusMismatches).toEqual([]);
    // Только нечисловые оценки (NaN, ±Inf); тексты различаются форматом
    // числа (`inf` в Rust, `Infinity` в JS), поэтому сверяется префикс.
    expect(errors).toHaveLength(40);
    for (const error of errors) {
      expect(error.expected).toMatch(/^non-finite trial score /);
      expect(error.got).toMatch(/^non-finite trial score /);
    }
  });

  it('value within tolerance', () => {
    const failures = compared
      .filter(
        ({ expected, got }) =>
          Math.abs(got.value - expected.value) > VALUE_ATOL,
      )
      .map(({ id, ratingMap }) => `${id}:${ratingMap}`);
    expect(failures).toEqual([]);
  });

  it('urgency within tolerance', () => {
    const failures = compared
      .filter(
        ({ expected, got }) =>
          Math.abs(got.urgency - expected.urgency) > URGENCY_ATOL,
      )
      .map(({ id, ratingMap }) => `${id}:${ratingMap}`);
    expect(failures).toEqual([]);
  });

  it('velocity is None exactly when Rust returns None and within tolerance', () => {
    const presence = compared.filter(
      ({ expected, got }) =>
        (expected.velocity === null) !== (got.velocity === null),
    );
    expect(presence.map(({ id }) => id)).toEqual([]);
    const failures = compared
      .filter(({ expected, got }) => {
        if (expected.velocity === null || got.velocity === null) return false;
        const allowed =
          VELOCITY.atol + VELOCITY.rtol * Math.abs(expected.velocity);
        return Math.abs(got.velocity - expected.velocity) > allowed;
      })
      .map(({ id }) => id);
    expect(failures).toEqual([]);
  });

  it('scheduler thresholds differ only on ties within the value tolerance', () => {
    const crossings = compared.flatMap(({ id, expected, got }) =>
      THRESHOLDS.filter(
        (threshold) => expected.value >= threshold !== got.value >= threshold,
      ).map((threshold) => ({ id, threshold, rust: expected.value })),
    );
    expect(crossings.length).toBeLessThanOrEqual(10);
    for (const { id, threshold, rust } of crossings) {
      expect(
        Math.abs(rust - threshold),
        `case ${id} crosses ${threshold} without being a tie`,
      ).toBeLessThanOrEqual(VALUE_ATOL);
    }
  });
});
