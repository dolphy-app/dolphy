import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ExerciseType } from '../../src/domain/manifest.ts';
import type { ExerciseDelta, ExerciseTrial } from '../../src/scoring/index.ts';

export const POWER_LAW_GOLDEN_PATH = fileURLToPath(
  new URL('./powerlaw.jsonl', import.meta.url),
);
export const FSRS_GOLDEN_PATH = fileURLToPath(
  new URL('./fsrs-scorer.jsonl', import.meta.url),
);

/** Число в JSON или `"NaN"` / `"Infinity"` / `"-Infinity"` строкой. */
type WireFloat = number | string;

interface WireCase {
  id: number;
  kind: string;
  type: ExerciseType;
  /** Только у fixture FSRS: `runner` | `anki`. */
  rating_map?: 'runner' | 'anki';
  trials: Array<{ score: WireFloat; timestamp: number }>;
  deltas: Array<{ delta: WireFloat; timestamp: number }>;
  now: number;
  expect:
    | {
        ok: true;
        value: WireFloat;
        urgency: WireFloat;
        velocity: WireFloat | null;
      }
    | { ok: false; error: string };
}

export type Expected =
  | { ok: true; value: number; urgency: number; velocity: number | null }
  | { ok: false; error: string };

/** Golden-кейс для TS API: метки — мс (Rust — секунды × 1000). */
export interface GoldenCase {
  id: number;
  kind: string;
  type: ExerciseType;
  ratingMap: 'runner' | 'anki' | null;
  trials: ExerciseTrial[];
  deltas: ExerciseDelta[];
  now: number;
  expect: Expected;
}

const SPECIAL: Record<string, number> = {
  NaN: Number.NaN,
  Infinity,
  '-Infinity': -Infinity,
};

const decode = (value: WireFloat) =>
  typeof value === 'string' ? (SPECIAL[value] as number) : value;

const toCase = (wire: WireCase): GoldenCase => ({
  id: wire.id,
  kind: wire.kind,
  type: wire.type,
  ratingMap: wire.rating_map ?? null,
  // `i64::MAX/MIN` секунд не представимы в double: округляются до ±2^63.
  trials: wire.trials.map((trial) => ({
    score: decode(trial.score),
    timestamp: trial.timestamp * 1000,
  })),
  deltas: wire.deltas.map((delta) => ({
    delta: decode(delta.delta),
    timestamp: delta.timestamp * 1000,
  })),
  now: wire.now * 1000,
  expect: wire.expect.ok
    ? {
        ok: true,
        value: decode(wire.expect.value),
        urgency: decode(wire.expect.urgency),
        velocity:
          wire.expect.velocity === null ? null : decode(wire.expect.velocity),
      }
    : wire.expect,
});

export const loadGoldenCases = (path: string): GoldenCase[] =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => toCase(JSON.parse(line) as WireCase));
