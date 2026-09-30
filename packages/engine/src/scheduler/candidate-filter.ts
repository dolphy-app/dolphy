import type {
  MasteryWindowDto,
  MasteryWindowName,
  SchedulerOptionsDto,
  UnitId,
} from '@dolphy-app/engine-contract';
import type { Rng } from '../ports/index.ts';
import { rustClamp, rustMax } from '../scoring/numeric.ts';
import type { Precision } from '../scoring/types.ts';
import type { KnockoutResult } from './review-knocker.ts';
import { isInWindow } from './options.ts';
import { roundOf } from './precision.ts';
import type { Candidate } from './types.ts';

export const MIN_CANDIDATE_WEIGHT = 0.05;
export const MIN_CANDIDATE_COST = 0.05;
export const MAX_CANDIDATE_COST = 100.0;
export const DEPTH_COST_COEFFICIENT = 0.7;
export const ENCOMPASSES_COST_COEFFICIENT = 0.9;
export const ENCOMPASSED_COST_COEFFICIENT = 0.6;
export const SCHEDULED_FREQUENCY_COST_COEFFICIENT = 2.0;
export const DEAD_END_COST_BONUS = 1.0;
export const VELOCITY_COST_COEFFICIENT = 0.5;
export const STAGNANT_VELOCITY_THRESHOLD = 0.2;
export const MASTERED_SCORE_THRESHOLD = 4.0;
export const STAGNANT_UNMASTERED_COST_BONUS = 0.7;
export const STAGNANT_MASTERED_COST_PENALTY = 1.0;
export const MIN_DYNAMIC_BATCH_SIZE = 10;

const OPTIMAL_SUCCESS_RATE_MAX = 0.9;
const OPTIMAL_SUCCESS_RATE_MIN = 0.75;
const MEDIUM_SUCCESS_RATE_MIN = 0.5;
const SHIFT_UP = 0.05;
const SHIFT_MEDIUM = -0.05;
const SHIFT_LOW = -0.1;
const MIN_WINDOW_PERCENTAGE = 0.05;
const MAX_WINDOW_PERCENTAGE = 0.5;

/** Стоимость показа: чем выше, тем меньше вес кандидата (`candidate_cost`). */
export const candidateCost = (candidate: Candidate) => {
  let logCost = 0;
  logCost -= DEPTH_COST_COEFFICIENT * Math.log1p(candidate.depth);
  logCost -=
    ENCOMPASSES_COST_COEFFICIENT * Math.log1p(candidate.encompassesWeight);
  logCost +=
    ENCOMPASSED_COST_COEFFICIENT * Math.log1p(candidate.encompassedWeight);
  logCost +=
    SCHEDULED_FREQUENCY_COST_COEFFICIENT * Math.log1p(candidate.frequency);
  if (candidate.deadEnd) logCost -= DEAD_END_COST_BONUS;

  const { velocity } = candidate;
  if (velocity !== null) {
    logCost += VELOCITY_COST_COEFFICIENT * -Math.log1p(velocity);
    if (Math.abs(velocity) < STAGNANT_VELOCITY_THRESHOLD) {
      if (candidate.exerciseScore >= MASTERED_SCORE_THRESHOLD) {
        logCost += STAGNANT_MASTERED_COST_PENALTY;
      } else {
        logCost -= STAGNANT_UNMASTERED_COST_BONUS;
      }
    }
  }
  return rustClamp(Math.exp(logCost), MIN_CANDIDATE_COST, MAX_CANDIDATE_COST);
};

/**
 * Вес выборки `urgency / sqrt(cost)`, не ниже `MIN_CANDIDATE_WEIGHT`.
 * `rustMax` игнорирует NaN, как `f32::max`: скорость ≤ −1 даёт `ln_1p = NaN` и
 * минимальный вес, а не NaN, ломающий выборку.
 */
export const candidateWeight = (candidate: Candidate) =>
  rustMax(
    candidate.urgency / Math.sqrt(candidateCost(candidate)),
    MIN_CANDIDATE_WEIGHT,
  );

/** Размер батча по числу кандидатов: не меньше трети кандидатов и десяти. */
export const dynamicBatchSize = (batchSize: number, candidateCount: number) => {
  if (batchSize < MIN_DYNAMIC_BATCH_SIZE) return batchSize;
  if (candidateCount < batchSize * 3) {
    return Math.max(Math.floor(candidateCount / 3), MIN_DYNAMIC_BATCH_SIZE);
  }
  return batchSize;
};

/**
 * Проценты окон с поправкой на success rate сессии: «трудные» окна (new,
 * target) растут при успехе > 0.90 и падают при < 0.75, «лёгкие» (easy,
 * mastered) — наоборот; `current` поглощает остаток. Оптимальная зона
 * [0.75, 0.90] опций не меняет. Порядок операций как в Rust (`f32` при
 * `precision: 'f32'`).
 */
export const adjustedMasteryWindows = (
  options: SchedulerOptionsDto,
  successRate: number,
  precision: Precision = 'f64',
): SchedulerOptionsDto => {
  const round = roundOf(precision);
  let shift = SHIFT_LOW;
  if (successRate > round(OPTIMAL_SUCCESS_RATE_MAX)) shift = SHIFT_UP;
  else if (successRate >= round(OPTIMAL_SUCCESS_RATE_MIN)) return options;
  else if (successRate >= round(MEDIUM_SUCCESS_RATE_MIN)) shift = SHIFT_MEDIUM;
  shift = round(shift);

  const clamp = (percentage: number) =>
    rustClamp(
      percentage,
      round(MIN_WINDOW_PERCENTAGE),
      round(MAX_WINDOW_PERCENTAGE),
    );
  const { masteryWindows: windows } = options;
  const shifted = (window: MasteryWindowDto, direction: 1 | -1) => ({
    ...window,
    percentage: clamp(round(round(window.percentage) + direction * shift)),
  });
  const newWindow = shifted(windows.new, 1);
  const target = shifted(windows.target, 1);
  const easy = shifted(windows.easy, -1);
  const mastered = shifted(windows.mastered, -1);
  const sum = round(
    round(round(newWindow.percentage + target.percentage) + easy.percentage) +
      mastered.percentage,
  );
  const current = {
    ...windows.current,
    percentage: rustMax(round(round(1.0) - sum), round(MIN_WINDOW_PERCENTAGE)),
  };
  return {
    ...options,
    masteryWindows: { new: newWindow, target, current, easy, mastered },
  };
};

/** Кандидаты окна, кроме сильно покрытых (порядок сохраняется). */
export const candidatesInWindow = (
  candidates: readonly Candidate[],
  encompassed: ReadonlySet<UnitId>,
  window: MasteryWindowDto,
): Candidate[] =>
  candidates.filter(
    (candidate) =>
      isInWindow(window, candidate.exerciseScore) &&
      !encompassed.has(candidate.exerciseId),
  );

export interface CandidateSelection {
  readonly selected: Candidate[];
  readonly remainder: Candidate[];
}

/**
 * Взвешенная выборка без возвращения `amount` кандидатов (`select_candidates`):
 * если кандидатов не больше, все идут в `selected` без обращения к `rng`.
 * Остаток — в исходном порядке. Распределение — Плакетта — Льюса; порядок
 * обращений к `rng` отличается от Rust (A-Res порта против A-ExpJ).
 */
export const selectWeighted = (
  candidates: readonly Candidate[],
  amount: number,
  rng: Rng,
): CandidateSelection => {
  if (candidates.length <= amount) {
    return { selected: [...candidates], remainder: [] };
  }
  const selected = rng.sampleWeighted(candidates, amount, candidateWeight);
  const selectedIds = new Set(
    selected.map((candidate) => candidate.exerciseId),
  );
  const remainder = candidates.filter(
    (candidate) => !selectedIds.has(candidate.exerciseId),
  );
  return { selected, remainder };
};

/**
 * Добор остатком: не заполняет батч сверх 3/4 `batchSize`, чтобы не терять
 * баланс окон; `maxAdded` ограничивает число добавленных.
 */
export const addRemainder = (
  batchSize: number,
  finalCandidates: Candidate[],
  remainder: readonly Candidate[],
  rng: Rng,
  maxAdded?: number,
) => {
  if (finalCandidates.length >= Math.floor((batchSize * 3) / 4)) return;
  const free = batchSize - finalCandidates.length;
  const amount = maxAdded === undefined ? free : Math.min(free, maxAdded);
  finalCandidates.push(...selectWeighted(remainder, amount, rng).selected);
};

export interface CandidateFilterDeps {
  /** Единый источник опций (не клон на момент создания). */
  options(): SchedulerOptionsDto;
  /** Success rate сессии (`SessionState.successRate`). */
  successRate(): number;
  readonly rng: Rng;
  readonly precision?: Precision;
}

export interface CandidateFilter {
  filterCandidates(result: KnockoutResult): Candidate[];
}

const QUOTA_ORDER: readonly MasteryWindowName[] = [
  'mastered',
  'easy',
  'current',
  'target',
  'new',
];

/**
 * `CandidateFilter` (`filter.rs`): раскладывает кандидатов по пяти окнам
 * мастерства, берёт из каждого квоту взвешенной выборкой и добирает остатком.
 * Квоты окон считаются в `precision` (`f32` даёт те же числа, что Rust:
 * `current` при success rate > 0.9 и `batchSize` 50 — 15, а не 14).
 */
export const createCandidateFilter = ({
  options,
  successRate,
  rng,
  precision = 'f64',
}: CandidateFilterDeps): CandidateFilter => {
  const round = roundOf(precision);

  const filterCandidates = ({
    candidates,
    highlyEncompassed,
  }: KnockoutResult) => {
    const adjusted = adjustedMasteryWindows(
      options(),
      successRate(),
      precision,
    );
    const batchSize = dynamicBatchSize(adjusted.batchSize, candidates.length);
    const batchSizeFloat = round(batchSize);
    const encompassed = new Set(highlyEncompassed.map((c) => c.exerciseId));

    const windows = new Map<MasteryWindowName, Candidate[]>();
    for (const name of QUOTA_ORDER) {
      windows.set(
        name,
        candidatesInWindow(
          candidates,
          encompassed,
          adjusted.masteryWindows[name],
        ),
      );
    }
    windows.get('mastered')?.push(...highlyEncompassed);

    const finalCandidates: Candidate[] = [];
    const remainders = new Map<MasteryWindowName, Candidate[]>();
    for (const name of QUOTA_ORDER) {
      const percentage = adjusted.masteryWindows[name].percentage;
      const quota = Math.trunc(
        rustMax(round(batchSizeFloat * round(percentage)), 1.0),
      );
      const { selected, remainder } = selectWeighted(
        windows.get(name) ?? [],
        quota,
        rng,
      );
      finalCandidates.push(...selected);
      remainders.set(name, remainder);
    }

    const baseRemainder = Math.max(Math.floor(batchSize / 10), 1);
    const fill: ReadonlyArray<
      readonly [MasteryWindowName, number | undefined]
    > = [
      ['current', undefined],
      ['new', 5 * baseRemainder],
      ['target', 3 * baseRemainder],
      ['easy', undefined],
      ['mastered', undefined],
    ];
    for (const [name, maxAdded] of fill) {
      addRemainder(
        batchSize,
        finalCandidates,
        remainders.get(name) ?? [],
        rng,
        maxAdded,
      );
    }
    return finalCandidates;
  };

  return { filterCandidates };
};
