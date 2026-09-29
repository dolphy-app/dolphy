/**
 * Golden L1: TS-порт против НАСТОЯЩЕГО Rust `PowerLawScorer` (Trane v0.34.1)
 * на `powerlaw.jsonl` (генератор `golden-rs`, seed 0x5EED7A4E20260929, 5 919
 * кейсов, из них 90 — ошибки).
 *
 * `f32` — двойник `Math.fround`: совпадает с Rust до 1 ulp (неточен только
 * `powf`). `f64` — продукция: совпадает до шума накопления f32, кроме мест,
 * где f32-округление Rust лежит точно на пороге (engine-ts/research/
 * report-powerlaw-port.md §3, §6).
 */
import { describe, expect, it } from 'vitest';
import {
  type Precision,
  type PowerLawScorer,
  createPowerLawScorer,
} from '../../src/scoring/index.ts';
import {
  THRESHOLDS,
  isCompared,
  runAll,
  summarize,
} from './golden-analysis.ts';
import {
  type GoldenCase,
  POWER_LAW_GOLDEN_PATH,
  loadGoldenCases,
} from './golden-cases.ts';

const cases = loadGoldenCases(POWER_LAW_GOLDEN_PATH);
const casesById = new Map(cases.map((golden) => [golden.id, golden]));

interface Tolerance {
  readonly atol: number;
  readonly rtol: number;
}
type OutputTolerance = Record<'value' | 'urgency' | 'velocity', Tolerance>;

/** Допуск `|got - expected| <= atol + rtol * |expected|`. */
const TOLERANCE: Record<Precision, OutputTolerance> = {
  // 1 ulp f32 на 4..8 — 4.8e-7; urgency = 1 − R несёт 1 ulp R (6e-8..1.2e-7).
  f32: {
    value: { atol: 1e-6, rtol: 0 },
    urgency: { atol: 2e-7, rtol: 0 },
    velocity: { atol: 1e-9, rtol: 1e-6 },
  },
  // f64: ошибка накопления f32 в Rust на цепочках ≤ 25 шагов и шум сокращения
  // МНК (до ~1e-2 при интервалах в секунды).
  f64: {
    value: { atol: 1e-5, rtol: 0 },
    urgency: { atol: 1e-6, rtol: 0 },
    velocity: { atol: 1e-2, rtol: 5e-5 },
  },
};

const isWithin = (expected: number, got: number, tolerance: Tolerance) => {
  if (Number.isNaN(expected) && Number.isNaN(got)) return true;
  if (expected === got) return true;
  const allowed = tolerance.atol + tolerance.rtol * Math.abs(expected);
  return Math.abs(got - expected) <= allowed;
};

/**
 * «Пол старого и хорошего» (`weighted >= 4.0 && days >= 50`) разрывает
 * `value` (до 0.75·4 = 3.0). Если f32 Rust и f64 попадают по разные стороны,
 * допуск не применим: такие кейсы не сравниваются по значению.
 */
const isFloorFlip = (
  golden: GoldenCase,
  a: PowerLawScorer,
  b: PowerLawScorer,
) => {
  if (!golden.expect.ok || golden.trials.length < 2) return false;
  const applied = ({ internals }: PowerLawScorer) => {
    const weighted = internals.computeWeightedAvg(
      golden.trials,
      (trial) => trial.score,
    );
    const newest = golden.trials[0]?.timestamp ?? golden.now;
    const days = Math.max(internals.elapsedDays(golden.now, newest), 0);
    const floor = internals.applyOldGoodRetrievabilityFloor(
      0,
      weighted,
      days,
      golden.trials.length,
    );
    return floor > 0;
  };
  return applied(a) !== applied(b);
};

const f64Scorer = createPowerLawScorer({ precision: 'f64' });
const f32Scorer = createPowerLawScorer({ precision: 'f32' });

describe('golden fixture powerlaw.jsonl', () => {
  it('has the documented shape', () => {
    expect(cases).toHaveLength(5919);
    expect(cases.filter((golden) => !golden.expect.ok)).toHaveLength(90);
    const kinds = new Set(cases.map((golden) => golden.kind));
    for (const kind of [
      'no_history',
      'old_good_floor',
      'delta_term',
      'mean_reversion',
      'error_ascending',
      'extreme_i64_gap',
      'extreme_1e10_days',
    ]) {
      expect(kinds.has(kind), `missing kind ${kind}`).toBe(true);
    }
    expect(Math.max(...cases.map((golden) => golden.trials.length))).toBe(25);
    const empty = cases.filter((golden) => golden.trials.length === 0);
    expect(
      empty.every(
        ({ expect: e }) =>
          e.ok && e.value === 0 && e.urgency === 1 && e.velocity === null,
      ),
    ).toBe(true);
  });
});

describe.each(['f32', 'f64'] as Precision[])(
  'golden L1 PowerLawScorer vs Rust (%s)',
  (precision) => {
    const scorer = precision === 'f32' ? f32Scorer : f64Scorer;
    const results = runAll(scorer, cases);
    const tolerance = TOLERANCE[precision];
    /** Только f64 может разойтись с Rust в проверке пола (f32-двойник точен). */
    const isFlip = ({ id }: { id: number }) =>
      precision === 'f64' &&
      isFloorFlip(casesById.get(id) as GoldenCase, f64Scorer, f32Scorer);

    it('Ok/Err status and error message equal Rust for every case', () => {
      const bad = results.filter(
        (result) =>
          result.expectedOk !== result.gotOk ||
          (!result.expectedOk && !result.errorMessageMatches),
      );
      expect(bad.map((result) => result.id)).toEqual([]);
    });

    it('velocity is None exactly when Rust returns None', () => {
      const bad = results.filter((result) => result.velocityPresenceMismatch);
      expect(bad.map((result) => result.id)).toEqual([]);
    });

    it.each(['value', 'urgency', 'velocity'] as const)(
      '%s within tolerance',
      (output) => {
        const failures = results
          .filter(isCompared)
          .filter((result) => !isFlip(result))
          .filter(({ expected, got }) => {
            const expectedValue = expected[output];
            const gotValue = got[output];
            if (expectedValue === null || gotValue === null) return false;
            return !isWithin(expectedValue, gotValue, tolerance[output]);
          })
          .map((result) => `${result.id}:${result.kind}`);
        expect(failures).toEqual([]);
      },
    );

    it('threshold sides (0.1, 2.5, 3.0, 3.75, 4.0, 4.5, 5.0) agree with Rust', () => {
      const crossing = results
        .filter(isCompared)
        .filter((result) => result.thresholdCrossings.length > 0);
      if (precision === 'f32') {
        expect(crossing.map((result) => result.id)).toEqual([]);
        return;
      }
      // f64 пересекает порог только на «ничьей» (2.9999998 против 3.0) или
      // при развороте пола: число ограничено, «ничью» доказываем.
      const nonFlip = crossing.filter((result) => !isFlip(result));
      expect(nonFlip.length).toBeLessThanOrEqual(10);
      for (const result of nonFlip) {
        const expected = result.expected.value;
        const isTie = THRESHOLDS.some((t) => Math.abs(expected - t) <= 1e-5);
        expect(isTie, `case ${result.id} crosses without being a tie`).toBe(
          true,
        );
      }
      expect(summarize(results).thresholdCrossingCases).toBeLessThanOrEqual(15);
    });

    it('|v| < 0.2 (stagnation test of the scheduler) agrees with Rust', () => {
      const flips = results.filter((result) => result.velocityStagnantFlip);
      expect(flips.map((result) => result.id)).toEqual([]);
    });

    if (precision === 'f32') {
      it('velocity is bit-identical to Rust f32 (no powf involved)', () => {
        const bad = results.filter(
          (result) => result.f32Exact.velocity === false,
        );
        expect(bad.map((result) => result.id)).toEqual([]);
      });

      it('value and urgency are bit-identical in >= 99% of cases', () => {
        const { outputs } = summarize(results);
        expect(outputs.value.exactF32 / outputs.value.n).toBeGreaterThanOrEqual(
          0.99,
        );
        expect(
          outputs.urgency.exactF32 / outputs.urgency.n,
        ).toBeGreaterThanOrEqual(0.99);
      });
    }
  },
);
