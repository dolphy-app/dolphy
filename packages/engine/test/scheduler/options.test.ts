/**
 * Холдер опций планировщика: умолчания Trane, `verify`, атомарный `set`,
 * подписчики и T-01 — смена опций доходит до `UnitScorer`, `CandidateFilter`,
 * `RelearnPile` и поиска сразу (в Rust у компонентов устаревшие клоны).
 */
import type { SchedulerOptionsDto } from '@lms/engine-contract';
import { createSeededRng } from '@lms/testkit';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SCHEDULER_OPTIONS,
  InvalidSchedulerOptionsError,
  applySchedulerPatch,
  createCandidate,
  createCandidateFilter,
  createRelearnPile,
  createSchedulerOptions,
  createSchedulerOptionsHolder,
  isInWindow,
  verifySchedulerOptions,
  windowNameOf,
} from '../../src/scheduler/index.ts';
import { createWorld } from './helpers/world.ts';

const defaults = (): SchedulerOptionsDto =>
  structuredClone(DEFAULT_SCHEDULER_OPTIONS);

const issuesOf = (options: SchedulerOptionsDto) => {
  try {
    verifySchedulerOptions(options);
  } catch (error) {
    if (error instanceof InvalidSchedulerOptionsError) return error.issues;
    throw error;
  }
  return [];
};

describe('умолчания и verify', () => {
  it('умолчания Trane проходят verify (сумма процентов в f64 ≠ 1.0 точно)', () => {
    const { masteryWindows: windows } = DEFAULT_SCHEDULER_OPTIONS;
    const sum = Object.values(windows).reduce(
      (total, window) => total + window.percentage,
      0,
    );
    expect(sum).not.toBe(1);
    expect(issuesOf(defaults())).toEqual([]);
  });

  it('значения умолчаний — как в data.rs', () => {
    expect(DEFAULT_SCHEDULER_OPTIONS).toMatchObject({
      batchSize: 50,
      relearnFraction: 0.1,
      passingScore: { minScore: 3.0, minFraction: 0.5, minAvgTrials: 1.8 },
      supersedingScore: 4.0,
      numTrials: 20,
      numRewards: 10,
      maxLessonsInProgress: 10,
    });
    expect(DEFAULT_SCHEDULER_OPTIONS.masteryWindows.target).toEqual({
      percentage: 0.2,
      range: [0.1, 2.5],
    });
  });

  it.each<[string, (o: SchedulerOptionsDto) => void]>([
    ['batchSize = 0', (o) => void (o.batchSize = 0)],
    ['дробный batchSize', (o) => void (o.batchSize = 1.5)],
    ['relearnFraction > 1', (o) => void (o.relearnFraction = 1.1)],
    ['relearnFraction < 0', (o) => void (o.relearnFraction = -0.1)],
    ['minScore = 4.0', (o) => void (o.passingScore.minScore = 4.0)],
    ['minScore < 0', (o) => void (o.passingScore.minScore = -1)],
    ['minFraction > 1', (o) => void (o.passingScore.minFraction = 2)],
    ['minAvgTrials < 1', (o) => void (o.passingScore.minAvgTrials = 0.9)],
    [
      'сумма процентов ≠ 1',
      (o) => void (o.masteryWindows.current.percentage = 0.5),
    ],
    [
      'new начинается не с 0',
      (o) => void (o.masteryWindows.new.range[0] = 0.5),
    ],
    [
      'mastered кончается не на 5',
      (o) => void (o.masteryWindows.mastered.range[1] = 4.9),
    ],
    [
      'разрыв между target и current',
      (o) => void (o.masteryWindows.target.range[1] = 2.4),
    ],
    ['maxLessonsInProgress = 0', (o) => void (o.maxLessonsInProgress = 0)],
    ['numTrials = 0', (o) => void (o.numTrials = 0)],
    ['NaN в supersedingScore', (o) => void (o.supersedingScore = Number.NaN)],
    ['lambda = 0', (o) => void (o.implicitCredit.lambda = 0)],
    ['minCredit > 1', (o) => void (o.implicitCredit.minCredit = 1.5)],
    ['failThreshold = 0', (o) => void (o.remediation.failThreshold = 0)],
    ['targetRetention = 1', (o) => void (o.plan.targetRetention = 1)],
    ['maxSameCourseRun = 0', (o) => void (o.plan.maxSameCourseRun = 0)],
    ['minTagDistance < 0', (o) => void (o.plan.minTagDistance = -1)],
  ])('отвергает: %s', (_name, corrupt) => {
    const options = defaults();
    corrupt(options);
    expect(issuesOf(options).length).toBeGreaterThan(0);
  });

  it('собирает все нарушения, а не только первое', () => {
    const options = defaults();
    options.batchSize = 0;
    options.maxLessonsInProgress = 0;
    expect(issuesOf(options)).toHaveLength(2);
  });
});

describe('окна мастерства', () => {
  it.each([
    [0.0, 'new'],
    [0.099, 'new'],
    [0.1, 'target'],
    [2.5, 'current'],
    [3.75, 'easy'],
    [4.5, 'mastered'],
    [5.0, 'mastered'],
  ])('оценка %s → окно %s', (score, name) => {
    expect(windowNameOf(DEFAULT_SCHEDULER_OPTIONS, score)).toBe(name);
  });

  it('верхняя граница 5.0 включена только у последнего окна', () => {
    const { masteryWindows: windows } = DEFAULT_SCHEDULER_OPTIONS;
    expect(isInWindow(windows.mastered, 5.0)).toBe(true);
    expect(isInWindow(windows.easy, 4.5)).toBe(false);
  });

  it('оценка в разрыве между окнами не относится ни к одному окну', () => {
    const holey = applySchedulerPatch(defaults(), {
      masteryWindows: { target: { range: [0.1, 2.0] } },
    });
    expect(windowNameOf(holey, 2.2)).toBeNull();
  });
});

describe('createSchedulerOptions', () => {
  it('подменяет batchSize из предпочтений и проверяет результат', () => {
    expect(createSchedulerOptions({ batchSize: 12 }).batchSize).toBe(12);
    expect(createSchedulerOptions({ batchSize: null }).batchSize).toBe(50);
    expect(() => createSchedulerOptions({ batchSize: 0 })).toThrow(
      InvalidSchedulerOptionsError,
    );
  });
});

describe('applySchedulerPatch', () => {
  it('сливает вложенные объекты и кортежи по элементам, не меняя вход', () => {
    const base = defaults();
    const merged = applySchedulerPatch(base, {
      batchSize: 8,
      passingScore: { minScore: 2.5 },
      masteryWindows: { target: { range: [0.15] } },
    });
    expect(merged.batchSize).toBe(8);
    expect(merged.passingScore).toEqual({
      minScore: 2.5,
      minFraction: 0.5,
      minAvgTrials: 1.8,
    });
    expect(merged.masteryWindows.target).toEqual({
      percentage: 0.2,
      range: [0.15, 2.5],
    });
    expect(base).toEqual(DEFAULT_SCHEDULER_OPTIONS);
  });
});

describe('холдер', () => {
  it('set применяет патч и оповещает подписчиков', () => {
    const holder = createSchedulerOptionsHolder();
    const listener = vi.fn();
    const unsubscribe = holder.subscribe(listener);
    const next = holder.set({ batchSize: 30 });
    expect(holder.get()).toBe(next);
    expect(next.batchSize).toBe(30);
    expect(listener).toHaveBeenCalledExactlyOnceWith(next);
    unsubscribe();
    holder.set({ batchSize: 31 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('невалидный патч отвергается целиком и не меняет состояние', () => {
    const holder = createSchedulerOptionsHolder();
    const listener = vi.fn();
    holder.subscribe(listener);
    const before = holder.get();
    expect(() =>
      holder.set({ batchSize: 20, maxLessonsInProgress: 0 }),
    ).toThrow(InvalidSchedulerOptionsError);
    expect(holder.get()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('снимок неизменяем', () => {
    const snapshot = createSchedulerOptionsHolder().get();
    expect(() => {
      snapshot.batchSize = 1;
    }).toThrow(TypeError);
  });

  it('reset возвращает опции, с которыми создан холдер', () => {
    const holder = createSchedulerOptionsHolder(
      createSchedulerOptions({ batchSize: 12 }),
    );
    holder.set({ batchSize: 40, relearnFraction: 0.3 });
    expect(holder.reset().batchSize).toBe(12);
    expect(holder.get().relearnFraction).toBe(0.1);
  });
});

describe('T-01: опции доходят до всех компонентов сразу', () => {
  it('UnitScorer: numTrials режет окно попыток без пересоздания', () => {
    const world = createWorld({
      courses: [{ id: '0', lessons: [{ id: '0::0', exercises: 1 }] }],
    });
    for (let i = 0; i < 5; i++) {
      world.record('0::0::0', 4);
      world.clock.advance(1000);
    }
    expect(world.scorer.getExerciseNumTrials('0::0::0')).toBe(5);
    world.options.set({ numTrials: 2 });
    world.scorer.invalidate(['0::0::0']);
    expect(world.scorer.getExerciseNumTrials('0::0::0')).toBe(2);
  });

  it('UnitScorer: supersedingScore решает, вытеснен ли юнит', () => {
    const world = createWorld({
      courses: [
        {
          id: '0',
          lessons: [
            { id: '0::0', exercises: 1 },
            { id: '0::1', exercises: 1, superseded: ['0::0'] },
          ],
        },
      ],
    });
    for (const id of ['0::0::0', '0::1::0']) world.record(id, 5);
    const superseding = new Set(['0::1']);
    expect(world.scorer.isSuperseded('0::0', superseding)).toBe(true);
    world.options.set({ supersedingScore: 5.5 });
    world.scorer.invalidate(['0::0', '0::1', '0::0::0', '0::1::0']);
    expect(world.scorer.isSuperseded('0::0', superseding)).toBe(false);
  });

  it('CandidateFilter: batchSize и окна читаются при каждом вызове', () => {
    const holder = createSchedulerOptionsHolder();
    const filter = createCandidateFilter({
      options: holder.get,
      successRate: () => 0.8,
      rng: createSeededRng(3),
    });
    const candidates = Array.from({ length: 200 }, (_, i) =>
      createCandidate({
        exerciseId: `e${i}`,
        lessonId: 'l',
        courseId: 'c',
        exerciseScore: 0.05 + (i % 20) * 0.25,
        urgency: 1,
        depth: 1,
      }),
    );
    const result = { candidates, highlyEncompassed: [] };
    expect(filter.filterCandidates(result).length).toBeGreaterThan(20);
    holder.set({ batchSize: 10 });
    expect(filter.filterCandidates(result).length).toBeLessThanOrEqual(10);
  });

  it('RelearnPile: relearnFraction и batchSize читаются при каждом выборе', () => {
    const holder = createSchedulerOptionsHolder();
    const pile = createRelearnPile({
      options: holder.get,
      rng: createSeededRng(5),
    });
    for (let i = 0; i < 40; i++) pile.update(`e${i}`, 1);
    const never = () => false;
    expect(pile.selectExercises(never)).toHaveLength(5);
    holder.set({ relearnFraction: 0.4 });
    expect(pile.selectExercises(never)).toHaveLength(20);
    holder.set({ batchSize: 10 });
    expect(pile.selectExercises(never)).toHaveLength(4);
  });

  it('поиск: passingScore и maxLessonsInProgress меняют выдачу', () => {
    const world = createWorld({
      seed: 7,
      courses: [
        {
          id: '0',
          lessons: [
            { id: '0::0', exercises: 2 },
            { id: '0::1', dependencies: ['0::0'], exercises: 2 },
          ],
        },
      ],
    });
    // одна попытка на упражнение: среднее число попыток 1 < 1.8 — урок 0::1 закрыт
    for (const id of ['0::0::0', '0::0::1']) world.record(id, 5);
    const lessonsOf = (batch: string[]) =>
      new Set(batch.map((id) => id.split('::').slice(0, 2).join('::')));
    expect(lessonsOf(world.getBatch())).toEqual(new Set(['0::0']));
    world.options.set({ passingScore: { minAvgTrials: 1.0 } });
    expect(lessonsOf(world.getBatch())).toEqual(new Set(['0::0', '0::1']));
  });

  it('невалидные опции отвергаются и не доходят до компонентов', () => {
    const world = createWorld({
      courses: [{ id: '0', lessons: [{ id: '0::0', exercises: 1 }] }],
    });
    expect(() => world.options.set({ numTrials: 0 })).toThrow(
      InvalidSchedulerOptionsError,
    );
    expect(world.options.get().numTrials).toBe(20);
  });
});
