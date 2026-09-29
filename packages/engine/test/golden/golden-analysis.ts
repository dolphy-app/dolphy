import type { ExerciseScore, ExerciseScorer } from '../../src/scoring/index.ts';
import type { GoldenCase } from './golden-cases.ts';

/** Пороги планировщика по `value` (data.rs:1061-1073, review_knocker.rs:17,25). */
export const THRESHOLDS = [0.1, 2.5, 3.0, 3.75, 4.0, 4.5, 5.0] as const;
/** «Стагнация»: `|v| < 0.2` (filter.rs:48-49). */
export const STAGNANT_VELOCITY_THRESHOLD = 0.2;
/** Ниже этой величины скорости считаются нулём при оценке смены знака. */
export const VELOCITY_SIGN_FLOOR = 1e-3;

export type OutputName = 'value' | 'urgency' | 'velocity';
export const OUTPUTS: readonly OutputName[] = ['value', 'urgency', 'velocity'];

export interface CaseResult {
  id: number;
  kind: string;
  expectedOk: boolean;
  gotOk: boolean;
  /** Оба вернули ошибку с одним текстом. */
  errorMessageMatches: boolean;
  expected: ExerciseScore | null;
  got: ExerciseScore | null;
  /** Абсолютная ошибка по выходу; `undefined`, если выход несравним. */
  abs: Partial<Record<OutputName, number>>;
  /** Относительная ошибка (`abs / |expected|`), только при `expected != 0`. */
  rel: Partial<Record<OutputName, number>>;
  /** `fround(got)` побитово равен выходу Rust f32. */
  f32Exact: Partial<Record<OutputName, boolean>>;
  velocityPresenceMismatch: boolean;
  velocityStagnantFlip: boolean;
  /** Пороги, по разные стороны которых лежат `value` Rust и TS (`x >= t`). */
  thresholdCrossings: number[];
}

const difference = (expected: number, got: number) => {
  if (Number.isNaN(expected) && Number.isNaN(got)) return 0;
  if (Number.isNaN(expected) || Number.isNaN(got)) return Infinity;
  if (expected === got) return 0;
  return Math.abs(got - expected);
};

/** Результат, где оба скорера вернули оценку: `expected` и `got` заданы. */
export interface ComparedResult extends CaseResult {
  expected: ExerciseScore;
  got: ExerciseScore;
}

export const isCompared = (result: CaseResult): result is ComparedResult =>
  result.expected !== null && result.got !== null;

const isStagnant = (velocity: number) =>
  Math.abs(velocity) < STAGNANT_VELOCITY_THRESHOLD;

export const runCase = (scorer: ExerciseScorer, golden: GoldenCase) => {
  let got: ExerciseScore | null = null;
  let gotError: string | null = null;
  try {
    got = scorer.score(golden.type, golden.trials, golden.deltas, golden.now);
  } catch (error) {
    gotError = error instanceof Error ? error.message : String(error);
  }
  const { expect } = golden;
  const result: CaseResult = {
    id: golden.id,
    kind: golden.kind,
    expectedOk: expect.ok,
    gotOk: got !== null,
    errorMessageMatches: !expect.ok && gotError === expect.error,
    expected: null,
    got: null,
    abs: {},
    rel: {},
    f32Exact: {},
    velocityPresenceMismatch: false,
    velocityStagnantFlip: false,
    thresholdCrossings: [],
  };
  if (!expect.ok || got === null) return result;

  result.expected = expect;
  result.got = got;
  for (const output of ['value', 'urgency'] as const) {
    const error = difference(expect[output], got[output]);
    result.abs[output] = error;
    if (expect[output] !== 0 && Number.isFinite(expect[output])) {
      result.rel[output] = error / Math.abs(expect[output]);
    }
    const bothNaN = Number.isNaN(expect[output]) && Number.isNaN(got[output]);
    result.f32Exact[output] =
      Object.is(Math.fround(got[output]), expect[output]) || bothNaN;
  }
  if ((expect.velocity === null) !== (got.velocity === null)) {
    result.velocityPresenceMismatch = true;
  } else if (expect.velocity !== null && got.velocity !== null) {
    const error = difference(expect.velocity, got.velocity);
    result.abs.velocity = error;
    if (expect.velocity !== 0 && Number.isFinite(expect.velocity)) {
      result.rel.velocity = error / Math.abs(expect.velocity);
    }
    result.f32Exact.velocity = Object.is(
      Math.fround(got.velocity),
      expect.velocity,
    );
    result.velocityStagnantFlip =
      isStagnant(expect.velocity) !== isStagnant(got.velocity);
  }
  for (const threshold of THRESHOLDS) {
    if (expect.value >= threshold !== got.value >= threshold) {
      result.thresholdCrossings.push(threshold);
    }
  }
  return result;
};

export const runAll = (
  scorer: ExerciseScorer,
  cases: readonly GoldenCase[],
): CaseResult[] => cases.map((golden) => runCase(scorer, golden));

export interface OutputStats {
  n: number;
  maxAbs: number;
  meanAbs: number;
  exactF32: number;
}

const statsOf = (output: OutputName, results: readonly CaseResult[]) => {
  const abs = results
    .map((result) => result.abs[output])
    .filter((error): error is number => error !== undefined);
  const sum = abs.reduce((total, error) => total + error, 0);
  return {
    n: abs.length,
    maxAbs: abs.length > 0 ? Math.max(...abs) : 0,
    meanAbs: abs.length > 0 ? sum / abs.length : 0,
    exactF32: results.filter((result) => result.f32Exact[output] === true)
      .length,
  };
};

export interface Summary {
  outputs: Record<OutputName, OutputStats>;
  thresholdCrossingCases: number;
}

export const summarize = (results: readonly CaseResult[]): Summary => {
  const comparable = results.filter(
    (result) => result.expectedOk && result.gotOk,
  );
  return {
    thresholdCrossingCases: results.filter(
      (result) => result.thresholdCrossings.length > 0,
    ).length,
    outputs: {
      value: statsOf('value', comparable),
      urgency: statsOf('urgency', comparable),
      velocity: statsOf('velocity', comparable),
    },
  };
};
