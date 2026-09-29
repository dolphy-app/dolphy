/**
 * Порт модульных тестов `scheduler/filter.rs` (mod test, :343-808, 18
 * тестов) и пробелов спеки `spec-scoring-filter.md` §5.9: `selectWeighted`
 * (без `Rng` при n ≥ len, статистика на примере §5.5), `createCandidateFilter`
 * целиком (порядок окон, highly → mastered, добор 3/4 с лимитами 5·base и
 * 3·base), NaN-скорость, квоты `f32`, значения `candidateCost` примера §5.5.
 *
 * Отличия от Rust: `Rng` инжектируется, тесты выборки проверяют длины и
 * состав, а не порядок; `success_rate` и опции подаются функциями фильтра.
 */
import type {
  MasteryWindowDto,
  SchedulerOptionsDto,
} from '@lms/engine-contract';
import { createSeededRng } from '@lms/testkit';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHEDULER_OPTIONS,
  MAX_CANDIDATE_COST,
  MIN_CANDIDATE_COST,
  MIN_CANDIDATE_WEIGHT,
  MIN_DYNAMIC_BATCH_SIZE,
  addRemainder,
  adjustedMasteryWindows,
  candidateCost,
  candidateWeight,
  candidatesInWindow,
  createCandidate,
  createCandidateFilter,
  dynamicBatchSize,
  selectWeighted,
} from '../../src/scheduler/index.ts';
import type { Candidate } from '../../src/scheduler/index.ts';
import type { Precision } from '../../src/scoring/index.ts';
import { createCountingRng } from './helpers/counting-rng.ts';

/** Кандидат с единичной срочностью (`weighted_candidate`). */
const weighted = (fields: Partial<Candidate> = {}) =>
  createCandidate({ exerciseId: 'exercise', urgency: 1.0, ...fields });

const named = (exerciseId: string, fields: Partial<Candidate> = {}) =>
  createCandidate({ exerciseId, ...fields });

const optionsWith = (
  patch: Partial<SchedulerOptionsDto> = {},
): SchedulerOptionsDto => ({ ...DEFAULT_SCHEDULER_OPTIONS, ...patch });

describe('dynamicBatchSize', () => {
  it('dynamic_batch_size: малые батчи не меняются, при нехватке кандидатов сжимается', () => {
    expect(dynamicBatchSize(5, 10)).toBe(5);
    expect(dynamicBatchSize(50, 70)).toBe(Math.floor(70 / 3));
    expect(dynamicBatchSize(50, 10)).toBe(MIN_DYNAMIC_BATCH_SIZE);
    expect(dynamicBatchSize(50, 150)).toBe(50);
    expect(dynamicBatchSize(50, 200)).toBe(50);
  });
});

describe('candidatesInWindow', () => {
  it('candidates_in_window: окно [2, 4) без сильно покрытых', () => {
    const candidates = [
      named('exercise1', { exerciseScore: 2.1 }),
      named('exercise2', { exerciseScore: 3.0 }),
      named('exercise3', { exerciseScore: 3.7 }),
      named('exercise4', { exerciseScore: 1.0 }),
      named('exercise5', { exerciseScore: 3.5 }),
    ];
    const inWindow = candidatesInWindow(
      candidates,
      new Set(['exercise1', 'exercise5']),
      { percentage: 1.0, range: [2.0, 4.0] },
    );
    expect(inWindow.map((c) => c.exerciseId)).toEqual([
      'exercise2',
      'exercise3',
    ]);
  });

  it('верхняя граница окна исключена, кроме окна до 5.0', () => {
    const at = (score: number) => named('e', { exerciseScore: score });
    const window: MasteryWindowDto = { percentage: 1.0, range: [2.0, 4.0] };
    expect(candidatesInWindow([at(2.0)], new Set(), window)).toHaveLength(1);
    expect(candidatesInWindow([at(4.0)], new Set(), window)).toHaveLength(0);
    const last: MasteryWindowDto = { percentage: 1.0, range: [4.5, 5.0] };
    expect(candidatesInWindow([at(5.0)], new Set(), last)).toHaveLength(1);
  });
});

describe('addRemainder', () => {
  const remainder = [2, 3, 4].map((i) =>
    named(`exercise${i}`, { urgency: 1.0 }),
  );

  it('add_remainder: добавляет при нехватке, не добавляет при заполненности 3/4, уважает maxAdded', () => {
    const batchSize = 10;
    const counting = createCountingRng();

    // мало кандидатов: добавляется весь остаток, батч не переполняется
    const sparse = [named('exercise1')];
    addRemainder(batchSize, sparse, remainder, counting.rng);
    expect(sparse).toHaveLength(4);
    expect(sparse.length).toBeLessThan(batchSize);
    // остаток короче свободных мест ⇒ выборка «все» без rng
    expect(counting.total()).toBe(0);

    // ⌊30/4⌋ + 1 = 8 кандидатов: порог 3/4 достигнут
    const full = Array.from({ length: 8 }, (_, i) => named(`full${i}`));
    addRemainder(batchSize, full, remainder, counting.rng);
    expect(full).toHaveLength(8);

    // maxAdded ограничивает число добавленных
    const limited = [named('exercise1')];
    addRemainder(batchSize, limited, remainder, counting.rng, 1);
    expect(limited).toHaveLength(2);
    expect(remainder).toContain(limited[1]);
    expect(counting.calls.sampleWeighted).toBe(1);
  });

  it('граница порога: ровно ⌊3·bs/4⌋ — не добавляет, на единицу меньше — добавляет', () => {
    const counting = createCountingRng();
    const atThreshold = Array.from({ length: 7 }, (_, i) => named(`a${i}`));
    addRemainder(10, atThreshold, remainder, counting.rng);
    expect(atThreshold).toHaveLength(7);
    const below = Array.from({ length: 6 }, (_, i) => named(`b${i}`));
    addRemainder(10, below, remainder, counting.rng);
    expect(below).toHaveLength(9);
  });
});

describe('candidateWeight', () => {
  it('more_hops_more_weight: больше хопов — больше вес', () => {
    expect(candidateWeight(weighted())).toBeLessThan(
      candidateWeight(weighted({ depth: 10 })),
    );
  });

  it('higher_urgency_more_weight: выше срочность — больше вес', () => {
    expect(
      candidateWeight(createCandidate({ exerciseId: 'a', urgency: 1 })),
    ).toBeGreaterThan(
      candidateWeight(createCandidate({ exerciseId: 'b', urgency: 0.25 })),
    );
  });

  it('more_scheduled_frequency_less_weight: чаще показывали — меньше вес', () => {
    expect(candidateWeight(weighted({ frequency: 5 }))).toBeLessThan(
      candidateWeight(weighted({ frequency: 1 })),
    );
  });

  it('higher_encompassed_weight_less_weight: сильнее покрыт — меньше вес', () => {
    expect(candidateWeight(weighted({ encompassedWeight: 10 }))).toBeLessThan(
      candidateWeight(weighted({ encompassedWeight: 3 })),
    );
  });

  it('higher_encompasses_weight_more_weight: покрывает больше — больше вес', () => {
    expect(
      candidateWeight(weighted({ encompassesWeight: 10 })),
    ).toBeGreaterThan(candidateWeight(weighted({ encompassesWeight: 3 })));
  });

  it('dead_end_more_weight: тупик дешевле и весомее', () => {
    const base = weighted();
    const deadEnd = weighted({ deadEnd: true });
    expect(candidateCost(deadEnd)).toBeLessThan(candidateCost(base));
    expect(candidateWeight(deadEnd)).toBeGreaterThan(candidateWeight(base));
  });

  it('candidate_weight_clamped: вес очень хороших кандидатов поднят до минимума', () => {
    const c = weighted({
      depth: 500,
      encompassesWeight: 500,
      deadEnd: true,
      urgency: 0.0001,
    });
    expect(candidateWeight(c)).toBe(MIN_CANDIDATE_WEIGHT);
  });

  it('нулевая срочность даёт минимальный вес, а не ноль', () => {
    expect(candidateWeight(weighted({ urgency: 0 }))).toBe(
      MIN_CANDIDATE_WEIGHT,
    );
  });
});

describe('candidateCost', () => {
  it('candidate_cost_clamped: стоимость в границах [0.05, 100]', () => {
    const favorable = weighted({
      depth: 500,
      encompassesWeight: 500,
      deadEnd: true,
    });
    const unfavorable = weighted({
      frequency: 1000,
      encompassedWeight: 1000,
      velocity: 10.0,
    });
    expect(candidateCost(favorable)).toBe(MIN_CANDIDATE_COST);
    expect(candidateCost(unfavorable)).toBe(MAX_CANDIDATE_COST);
  });

  it('пример §5.5: A 4.2825, B 0.1849, C 19.0949; веса 0.28994, 2.09302, 0.05', () => {
    const a = createCandidate({
      exerciseId: 'A',
      urgency: 0.6,
      depth: 3,
      frequency: 1,
      encompassesWeight: 2.0,
      encompassedWeight: 5.0,
      velocity: 0.1,
      exerciseScore: 4.2,
    });
    const b = createCandidate({
      exerciseId: 'B',
      urgency: 0.9,
      depth: 1,
      deadEnd: true,
      velocity: 0.5,
      exerciseScore: 2.0,
    });
    const c = createCandidate({
      exerciseId: 'C',
      urgency: 0.2,
      depth: 6,
      frequency: 3,
      encompassedWeight: 12.0,
      exerciseScore: 4.8,
    });
    expect(candidateCost(a)).toBeCloseTo(4.2825, 4);
    expect(candidateCost(b)).toBeCloseTo(0.1849, 4);
    expect(candidateCost(c)).toBeCloseTo(19.0949, 4);
    expect(candidateWeight(a)).toBeCloseTo(0.28994, 4);
    expect(candidateWeight(b)).toBeCloseTo(2.09302, 4);
    expect(candidateWeight(c)).toBe(MIN_CANDIDATE_WEIGHT);
  });

  // логарифмические члены и константы из таблицы §5.5 по одному
  it.each([
    { name: 'depth 3', fields: { depth: 3 }, logCost: -0.97041 },
    {
      name: 'encompasses 2',
      fields: { encompassesWeight: 2 },
      logCost: -0.98875,
    },
    {
      name: 'encompassed 5',
      fields: { encompassedWeight: 5 },
      logCost: 1.07506,
    },
    { name: 'frequency 1', fields: { frequency: 1 }, logCost: 1.38629 },
    { name: 'dead end', fields: { deadEnd: true }, logCost: -1.0 },
    {
      name: 'velocity 0.5 (не стагнация)',
      fields: { velocity: 0.5, exerciseScore: 2.0 },
      logCost: -0.20273,
    },
    {
      name: 'стагнация, score < 4.0: бонус 0.7',
      fields: { velocity: 0.05, exerciseScore: 2.0 },
      logCost: -0.024395 - 0.7,
    },
    {
      name: 'стагнация, score ≥ 4.0: штраф 1.0',
      fields: { velocity: 0.05, exerciseScore: 4.0 },
      logCost: -0.024395 + 1.0,
    },
  ])('член log_cost: $name', ({ fields, logCost }) => {
    expect(candidateCost(weighted(fields))).toBeCloseTo(Math.exp(logCost), 4);
  });

  it('|velocity| ровно 0.2 — уже не стагнация', () => {
    const active = candidateCost(weighted({ velocity: 0.2 }));
    expect(active).toBeCloseTo(Math.exp(-0.5 * Math.log1p(0.2)), 5);
  });
});

describe('velocity', () => {
  it('positive_velocity_more_weight: быстрее прогресс — больше вес', () => {
    const base = weighted({ exerciseScore: 2.0, velocity: 1.0 });
    const slow = weighted({ exerciseScore: 2.0, velocity: 0.5 });
    expect(candidateWeight(base)).toBeGreaterThan(candidateWeight(slow));
  });

  it('negative_velocity_less_weight: скорость −1 — минимальная стоимость-штраф, вес ниже', () => {
    const base = weighted({ exerciseScore: 2.0 });
    const negative = weighted({ exerciseScore: 2.0, velocity: -1.0 });
    expect(candidateWeight(negative)).toBeLessThan(candidateWeight(base));
    // ln(1 + v) = −∞ ⇒ стоимость упирается в потолок 100, вес 1/√100
    expect(candidateCost(negative)).toBe(MAX_CANDIDATE_COST);
    expect(candidateWeight(negative)).toBeCloseTo(0.1, 6);
  });

  it('скорость < −1: ln_1p = NaN, вес — минимальный, а не NaN', () => {
    const weight = candidateWeight(weighted({ velocity: -2.0 }));
    expect(Number.isNaN(weight)).toBe(false);
    expect(weight).toBe(MIN_CANDIDATE_WEIGHT);
  });

  it('кандидат с NaN-весом остаётся выбираемым: выборка возвращает запрошенное число', () => {
    const candidates = [
      weighted({ exerciseId: 'nan', velocity: -3.0 }),
      weighted({ exerciseId: 'ok-1' }),
      weighted({ exerciseId: 'ok-2' }),
    ];
    const { selected, remainder } = selectWeighted(
      candidates,
      2,
      createSeededRng(3),
    );
    expect(selected).toHaveLength(2);
    expect(remainder).toHaveLength(1);
  });

  it('stagnant_low_score_gets_bonus: стагнация при низкой оценке — дешевле', () => {
    const base = weighted({ exerciseScore: 2.0 });
    const stagnant = weighted({ exerciseScore: 2.0, velocity: 0.05 });
    expect(candidateCost(stagnant)).toBeLessThan(candidateCost(base));
    expect(candidateWeight(stagnant)).toBeGreaterThan(candidateWeight(base));
  });

  it('stagnant_high_score_gets_penalty: стагнация при высокой оценке — дороже', () => {
    const base = weighted({ exerciseScore: 4.5 });
    const stagnant = weighted({ exerciseScore: 4.5, velocity: 0.05 });
    expect(candidateCost(stagnant)).toBeGreaterThan(candidateCost(base));
    expect(candidateWeight(stagnant)).toBeLessThan(candidateWeight(base));
  });

  it('positive_velocity_reduces_cost: скорость выше порога стагнации снижает стоимость', () => {
    const base = weighted({ exerciseScore: 2.0 });
    const active = weighted({ exerciseScore: 2.0, velocity: 0.5 });
    expect(candidateCost(active)).toBeLessThan(candidateCost(base));
    expect(candidateWeight(active)).toBeGreaterThan(candidateWeight(base));
  });

  it('negative_velocity_increases_cost: отрицательная скорость повышает стоимость', () => {
    const base = weighted({ exerciseScore: 2.0 });
    const active = weighted({ exerciseScore: 2.0, velocity: -0.5 });
    expect(candidateCost(active)).toBeGreaterThan(candidateCost(base));
    expect(candidateWeight(active)).toBeLessThan(candidateWeight(base));
  });
});

describe('adjustedMasteryWindows', () => {
  const percentages = (options: SchedulerOptionsDto) => {
    const { new: n, target, current, easy, mastered } = options.masteryWindows;
    return {
      new: n.percentage,
      target: target.percentage,
      current: current.percentage,
      easy: easy.percentage,
      mastered: mastered.percentage,
    };
  };
  const defaults = percentages(DEFAULT_SCHEDULER_OPTIONS);

  it('adjusted_mastery_windows: оптимальная зона [0.75, 0.90] без изменений', () => {
    for (const rate of [0.75, 0.85, 0.9]) {
      expect(
        percentages(adjustedMasteryWindows(DEFAULT_SCHEDULER_OPTIONS, rate)),
      ).toEqual(defaults);
    }
    // f32: 9/10 округляется в литерал 0.90 — «в зоне»
    expect(
      percentages(
        adjustedMasteryWindows(
          DEFAULT_SCHEDULER_OPTIONS,
          Math.fround(0.9),
          'f32',
        ),
      ),
    ).toEqual(defaults);
  });

  it('adjusted_mastery_windows: > 0.90 сдвигает к трудным окнам', () => {
    const adjusted = percentages(
      adjustedMasteryWindows(DEFAULT_SCHEDULER_OPTIONS, 0.95),
    );
    expect(adjusted.new).toBeGreaterThan(defaults.new);
    expect(adjusted.target).toBeGreaterThan(defaults.target);
    expect(adjusted.easy).toBeLessThan(defaults.easy);
    expect(adjusted.mastered).toBeLessThan(defaults.mastered);
  });

  it('adjusted_mastery_windows: [0.5, 0.75) сдвигает к лёгким окнам, < 0.5 — сильнее', () => {
    const hard = percentages(
      adjustedMasteryWindows(DEFAULT_SCHEDULER_OPTIONS, 0.6),
    );
    expect(hard.new).toBeLessThan(defaults.new);
    expect(hard.target).toBeLessThan(defaults.target);
    expect(hard.easy).toBeGreaterThan(defaults.easy);
    expect(hard.mastered).toBeGreaterThan(defaults.mastered);
    const veryHard = percentages(
      adjustedMasteryWindows(DEFAULT_SCHEDULER_OPTIONS, 0.3),
    );
    expect(veryHard.easy).toBeGreaterThan(hard.easy);
    expect(veryHard.mastered).toBeGreaterThan(hard.mastered);
    expect(veryHard.new).toBeLessThan(hard.new);
    expect(veryHard.target).toBeLessThan(hard.target);
  });

  it.each([
    { rate: 0.95, expected: [0.25, 0.25, 0.3, 0.15, 0.05] },
    { rate: 0.6, expected: [0.15, 0.15, 0.3, 0.25, 0.15] },
    { rate: 0.3, expected: [0.1, 0.1, 0.3, 0.3, 0.2] },
  ])(
    'проценты §5.3 при success rate $rate: new, target, current, easy, mastered',
    ({ rate, expected }) => {
      for (const precision of ['f64', 'f32'] as const) {
        const adjusted = percentages(
          adjustedMasteryWindows(DEFAULT_SCHEDULER_OPTIONS, rate, precision),
        );
        const actual = [
          adjusted.new,
          adjusted.target,
          adjusted.current,
          adjusted.easy,
          adjusted.mastered,
        ];
        actual.forEach((value, index) => {
          expect(value).toBeCloseTo(expected[index] ?? Number.NaN, 5);
        });
      }
    },
  );

  it('пять окон дают в сумме 1.0 (±1e-6) при любом success rate', () => {
    for (const precision of ['f64', 'f32'] as const) {
      for (const rate of [0.0, 0.3, 0.6, 0.8, 0.95, 1.0]) {
        const adjusted = percentages(
          adjustedMasteryWindows(DEFAULT_SCHEDULER_OPTIONS, rate, precision),
        );
        const sum = Object.values(adjusted).reduce((a, b) => a + b, 0);
        expect(Math.abs(sum - 1.0)).toBeLessThan(1e-6);
      }
    }
  });

  it('проценты зажаты в [0.05, 0.5]; current не ниже 0.05', () => {
    const extreme: SchedulerOptionsDto = {
      ...DEFAULT_SCHEDULER_OPTIONS,
      masteryWindows: {
        new: { percentage: 0.5, range: [0.0, 0.1] },
        target: { percentage: 0.3, range: [0.1, 2.5] },
        current: { percentage: 0.12, range: [2.5, 3.75] },
        easy: { percentage: 0.04, range: [3.75, 4.5] },
        mastered: { percentage: 0.04, range: [4.5, 5.0] },
      },
    };
    const adjusted = percentages(adjustedMasteryWindows(extreme, 0.95));
    expect(adjusted.new).toBe(0.5);
    expect(adjusted.target).toBeCloseTo(0.35, 6);
    expect(adjusted.easy).toBe(0.05);
    expect(adjusted.mastered).toBe(0.05);
    expect(adjusted.current).toBeGreaterThanOrEqual(0.05 - 1e-9);
  });

  it('входные опции не меняются, диапазоны окон сохраняются', () => {
    const adjusted = adjustedMasteryWindows(DEFAULT_SCHEDULER_OPTIONS, 0.3);
    expect(adjusted).not.toBe(DEFAULT_SCHEDULER_OPTIONS);
    expect(percentages(DEFAULT_SCHEDULER_OPTIONS)).toEqual(defaults);
    expect(adjusted.masteryWindows.target.range).toEqual(
      DEFAULT_SCHEDULER_OPTIONS.masteryWindows.target.range,
    );
    expect(adjusted.batchSize).toBe(DEFAULT_SCHEDULER_OPTIONS.batchSize);
  });
});

describe('selectWeighted', () => {
  const pool = (count: number) =>
    Array.from({ length: count }, (_, i) => weighted({ exerciseId: `e${i}` }));

  it('n ≥ len: все кандидаты в исходном порядке, остаток пуст, rng не тронут', () => {
    for (const amount of [3, 4, 100]) {
      const counting = createCountingRng();
      const candidates = pool(3);
      const { selected, remainder } = selectWeighted(
        candidates,
        amount,
        counting.rng,
      );
      expect(selected).toEqual(candidates);
      expect(selected).not.toBe(candidates);
      expect(remainder).toEqual([]);
      expect(counting.total()).toBe(0);
    }
  });

  it('пустой список — пустая выборка без обращений к rng', () => {
    const counting = createCountingRng();
    expect(selectWeighted([], 5, counting.rng)).toEqual({
      selected: [],
      remainder: [],
    });
    expect(counting.total()).toBe(0);
  });

  it('n < len: ровно n выбранных, остаток — дополнение в исходном порядке, одно обращение', () => {
    const counting = createCountingRng(11);
    const candidates = pool(10);
    const { selected, remainder } = selectWeighted(candidates, 4, counting.rng);
    expect(selected).toHaveLength(4);
    expect(new Set(selected.map((c) => c.exerciseId)).size).toBe(4);
    expect(remainder).toEqual(candidates.filter((c) => !selected.includes(c)));
    expect(counting.calls.sampleWeighted).toBe(1);
    expect(counting.total()).toBe(1);
  });

  it('n = 0 при непустом списке: ничего не выбрано, весь список в остатке', () => {
    const candidates = pool(3);
    const { selected, remainder } = selectWeighted(
      candidates,
      0,
      createSeededRng(1),
    );
    expect(selected).toEqual([]);
    expect(remainder).toEqual(candidates);
  });

  it('частота выбора одного из A, B, C пропорциональна весам примера §5.5', () => {
    const a = createCandidate({
      exerciseId: 'A',
      urgency: 0.6,
      depth: 3,
      frequency: 1,
      encompassesWeight: 2.0,
      encompassedWeight: 5.0,
      velocity: 0.1,
      exerciseScore: 4.2,
    });
    const b = createCandidate({
      exerciseId: 'B',
      urgency: 0.9,
      depth: 1,
      deadEnd: true,
      velocity: 0.5,
      exerciseScore: 2.0,
    });
    const c = createCandidate({
      exerciseId: 'C',
      urgency: 0.2,
      depth: 6,
      frequency: 3,
      encompassedWeight: 12.0,
      exerciseScore: 4.8,
    });
    const rng = createSeededRng(20260929);
    const runs = 30_000;
    const counts: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (let run = 0; run < runs; run++) {
      const { selected } = selectWeighted([a, b, c], 1, rng);
      const [first] = selected;
      if (first !== undefined) counts[first.exerciseId]! += 1;
    }
    // веса 0.28994 / 2.09302 / 0.05 ⇒ вероятности 0.119 / 0.860 / 0.020
    expect(Math.abs((counts.A ?? 0) / runs - 0.1192)).toBeLessThan(0.012);
    expect(Math.abs((counts.B ?? 0) / runs - 0.8602)).toBeLessThan(0.012);
    expect(Math.abs((counts.C ?? 0) / runs - 0.0206)).toBeLessThan(0.008);
  });
});

describe('createCandidateFilter', () => {
  const WINDOW_SCORES = {
    mastered: 4.75,
    easy: 4.1,
    current: 3.0,
    target: 1.0,
    new: 0.05,
  } as const;
  const WINDOWS = Object.keys(WINDOW_SCORES) as Array<
    keyof typeof WINDOW_SCORES
  >;

  const inWindow = (window: keyof typeof WINDOW_SCORES, count: number) =>
    Array.from({ length: count }, (_, i) =>
      createCandidate({
        exerciseId: `${window}-${i}`,
        exerciseScore: WINDOW_SCORES[window],
        urgency: 1.0,
      }),
    );

  const windowOf = (candidate: Candidate) =>
    WINDOWS.find((name) => candidate.exerciseId.startsWith(`${name}-`));

  const countByWindow = (candidates: readonly Candidate[]) =>
    WINDOWS.map(
      (name) => candidates.filter((c) => windowOf(c) === name).length,
    );

  const run = (
    candidates: Candidate[],
    {
      highlyEncompassed = [],
      successRate = 0.8,
      options = optionsWith(),
      precision = 'f64',
      seed = 5,
    }: {
      highlyEncompassed?: Candidate[];
      successRate?: number;
      options?: SchedulerOptionsDto;
      precision?: Precision;
      seed?: number;
    } = {},
  ) => {
    const counting = createCountingRng(seed);
    const filter = createCandidateFilter({
      options: () => options,
      successRate: () => successRate,
      rng: counting.rng,
      precision,
    });
    const result = filter.filterCandidates({ candidates, highlyEncompassed });
    return { result, counting };
  };

  // квоты mastered, easy, current, target, new; §5.5 (Rust f32)
  it.each([
    { batchSize: 50, rate: 0.8, quotas: [5, 10, 15, 10, 10] },
    { batchSize: 50, rate: 0.95, quotas: [2, 7, 15, 12, 12] },
    { batchSize: 50, rate: 0.6, quotas: [7, 12, 14, 7, 7] },
    { batchSize: 50, rate: 0.3, quotas: [10, 15, 15, 5, 5] },
    { batchSize: 20, rate: 0.8, quotas: [2, 4, 6, 4, 4] },
    { batchSize: 20, rate: 0.95, quotas: [1, 3, 6, 5, 5] },
    { batchSize: 20, rate: 0.6, quotas: [3, 5, 5, 3, 3] },
    { batchSize: 20, rate: 0.3, quotas: [4, 6, 6, 2, 2] },
  ])(
    'квоты f32: batchSize $batchSize, success rate $rate → $quotas',
    ({ batchSize, rate, quotas }) => {
      // в каждом окне кандидатов больше квоты; сумма квот ≥ ¾ батча — добор не нужен
      const candidates = WINDOWS.flatMap((name) => inWindow(name, 60));
      const { result } = run(candidates, {
        successRate: rate,
        options: optionsWith({ batchSize }),
        precision: 'f32',
      });
      expect(countByWindow(result)).toEqual(quotas);
      expect(new Set(result.map((c) => c.exerciseId)).size).toBe(result.length);
    },
  );

  it('квоты f32 при большем числе кандидатов не зависят от их количества', () => {
    const candidates = WINDOWS.flatMap((name) => inWindow(name, 200));
    const { result } = run(candidates, {
      successRate: 0.95,
      precision: 'f32',
    });
    expect(countByWindow(result)).toEqual([2, 7, 15, 12, 12]);
  });

  it('динамический размер батча: 70 кандидатов → bs 23, квоты 2, 4, 6, 4, 4', () => {
    const candidates = WINDOWS.flatMap((name) => inWindow(name, 14));
    expect(candidates).toHaveLength(70);
    const { result } = run(candidates, { precision: 'f32' });
    expect(countByWindow(result)).toEqual([2, 4, 6, 4, 4]);
  });

  it('порядок окон результата: mastered → easy → current → target → new', () => {
    const candidates = [...WINDOWS]
      .reverse()
      .flatMap((name) => inWindow(name, 1));
    const { result, counting } = run(candidates);
    expect(result.map((c) => c.exerciseId)).toEqual([
      'mastered-0',
      'easy-0',
      'current-0',
      'target-0',
      'new-0',
    ]);
    // квоты не меньше числа кандидатов — rng не нужен
    expect(counting.total()).toBe(0);
  });

  it('highly encompassed уходят из своего окна в mastered', () => {
    const highly = createCandidate({
      exerciseId: 'easy-highly',
      exerciseScore: WINDOW_SCORES.easy,
      urgency: 1.0,
      encompassedWeight: 6,
    });
    const [easy] = inWindow('easy', 1);
    const candidates = [easy as Candidate, highly];
    const { result } = run(candidates, { highlyEncompassed: [highly] });
    // mastered-квота (первое окно) берёт highly, easy-окно остаётся с одним
    expect(result.map((c) => c.exerciseId)).toEqual(['easy-highly', 'easy-0']);
    const { result: without } = run(candidates);
    expect(without.map((c) => c.exerciseId)).toEqual(['easy-0', 'easy-highly']);
  });

  it('добор: current без лимита, батч доходит до размера', () => {
    const { result } = run(inWindow('current', 160));
    expect(result).toHaveLength(50);
    expect(new Set(result.map((c) => c.exerciseId)).size).toBe(50);
  });

  it('добор new ограничен 5·base: 10 + 25 = 35 из 50', () => {
    const { result } = run(inWindow('new', 160));
    // квота 10; свободно 40, лимит 5·⌊50/10⌋ = 25; 35 < ¾·50, но других окон нет
    expect(result).toHaveLength(35);
  });

  it('добор target ограничен 3·base: 10 + 15 = 25 из 50', () => {
    const { result } = run(inWindow('target', 160));
    expect(result).toHaveLength(25);
  });

  it('добор не запускается при заполненности ¾: 47 из 50 остаются 47', () => {
    const candidates = WINDOWS.flatMap((name) => inWindow(name, 60));
    const { result } = run(candidates, {
      successRate: 0.6,
      precision: 'f32',
    });
    expect(result).toHaveLength(47);
  });

  it('добор берёт остаток и из mastered, если остальные окна пусты', () => {
    const { result } = run(inWindow('mastered', 160));
    // квота mastered 5, остаток добирается без лимита до батча 50
    expect(result).toHaveLength(50);
  });

  it('опции и success rate читаются при каждом вызове', () => {
    let options = optionsWith({ batchSize: 50 });
    let rate = 0.8;
    const counting = createCountingRng();
    const filter = createCandidateFilter({
      options: () => options,
      successRate: () => rate,
      rng: counting.rng,
    });
    const knock = {
      candidates: WINDOWS.flatMap((name) => inWindow(name, 60)),
      highlyEncompassed: [],
    };
    expect(filter.filterCandidates(knock)).toHaveLength(50);
    options = optionsWith({ batchSize: 20 });
    expect(filter.filterCandidates(knock)).toHaveLength(20);
    rate = 0.3;
    expect(countByWindow(filter.filterCandidates(knock))).toEqual([
      4, 6, 6, 2, 2,
    ]);
  });

  it('пустая пачка — пустой результат; кандидат вне всех окон теряется', () => {
    expect(run([]).result).toEqual([]);
    const stray = createCandidate({ exerciseId: 'stray', exerciseScore: 2.6 });
    const gapped = optionsWith({
      masteryWindows: {
        ...DEFAULT_SCHEDULER_OPTIONS.masteryWindows,
        target: { percentage: 0.2, range: [0.1, 2.5] },
        current: { percentage: 0.3, range: [2.7, 3.75] },
      },
    });
    expect(run([stray], { options: gapped }).result).toEqual([]);
  });
});
