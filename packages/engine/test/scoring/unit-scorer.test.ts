/**
 * Порт 9 `#[test]` из `scheduler/unit_scorer.rs` (Trane v0.34.1, строки
 * 696-1025) плюс пробелы покрытия из engine-ts/research/spec-scoring-filter.md
 * §1.7: `is_fresh`, цепочка вытеснения, агрегаты `num_trials`, каскад
 * инвалидации, опции из единого источника. Каждый тест идёт с обоими
 * скорерами упражнения: PowerLaw (как в Rust) и FSRS (по умолчанию).
 *
 * Отступления: `score_exercise` Rust воссоздан хелпером `scoreExercise`
 * (попытка → инвалидация → награды → инвалидация обновлённых), время — мс на
 * `FakeClock`, `set_override_timestamp` заменён `clock.set`.
 */
import { createFakeClock } from '@spirula/testkit';
import { describe, expect, it } from 'vitest';
import type { ExerciseType } from '../../src/domain/manifest.ts';
import {
  type ExerciseScorer,
  type ExerciseTrial,
  MAX_CACHE_AGE_MS,
  type ScoringOptions,
  ScoringError,
  UnknownUnitError,
  createFsrsScorer,
  createPowerLawScorer,
  createRewardIndex,
  createUnitScorer,
  propagateRewards,
} from '../../src/scoring/index.ts';
import { createTsFsrsMemoryModel } from '../../src/scoring/memory-model.ts';
import {
  type TestGraph,
  createBlacklist,
  createTestGraph,
  createUnitScorerLibrary,
} from './test-graph.ts';

const DAY_MS = 86_400_000;

const EXERCISE_SCORERS: Array<[string, () => ExerciseScorer]> = [
  ['PowerLaw', () => createPowerLawScorer()],
  ['FSRS', () => createFsrsScorer({ memory: createTsFsrsMemoryModel() })],
];

interface HarnessOptions {
  graph?: TestGraph;
  createScorer: () => ExerciseScorer;
  options?: Partial<ScoringOptions>;
  blacklisted?: string[];
  types?: Map<string, ExerciseType>;
}

/** Всё, что `UnitScorer` берёт снаружи: попытки, награды, blacklist, часы. */
const createHarness = (settings: HarnessOptions) => {
  const graph = settings.graph ?? createUnitScorerLibrary();
  const clock = createFakeClock();
  const blacklist = createBlacklist(settings.blacklisted);
  const rewards = createRewardIndex();
  const trials = new Map<string, ExerciseTrial[]>();
  const options: ScoringOptions = {
    numTrials: 20,
    numRewards: 10,
    supersedingScore: 4.0,
    ...settings.options,
  };
  const scorer = createUnitScorer({
    clock,
    graph,
    blacklist,
    attempts: {
      getTrials: (exerciseId, limit) =>
        (trials.get(exerciseId) ?? []).slice(0, limit),
    },
    rewards,
    exerciseTypeOf: (id) => settings.types?.get(id) ?? null,
    exerciseScorer: settings.createScorer(),
    options: () => options,
  });

  const recordTrial = (exerciseId: string, grade: number, at: number) => {
    const history = [
      ...(trials.get(exerciseId) ?? []),
      { score: grade, timestamp: at },
    ];
    history.sort((a, b) => b.timestamp - a.timestamp);
    trials.set(exerciseId, history);
  };

  /** Как `score_exercise` Rust, без deltas и relearn pile. */
  const scoreExercise = (
    exerciseId: string,
    grade: 1 | 2 | 3 | 4 | 5,
    at: number,
  ) => {
    recordTrial(exerciseId, grade, at);
    scorer.invalidate([exerciseId]);
    const updated = rewards.record(
      propagateRewards(graph, exerciseId, grade, at),
    );
    scorer.invalidate(updated);
  };

  const scoreAll = (grade: 1 | 2 | 3 | 4 | 5, at: number) => {
    for (const exerciseId of graph.exerciseIds())
      scoreExercise(exerciseId, grade, at);
  };

  return {
    graph,
    clock,
    blacklist,
    rewards,
    options,
    scorer,
    scoreExercise,
    scoreAll,
    recordTrial,
  };
};

describe.each(EXERCISE_SCORERS)('UnitScorer with %s', (_name, createScorer) => {
  it('blacklisted_course_score', () => {
    const { scorer } = createHarness({ createScorer, blacklisted: ['0'] });
    expect(scorer.getUnitScore('0')).toBeNull();
  });

  it('no_valid_exercises_have_scores', () => {
    const { scorer } = createHarness({ createScorer, blacklisted: ['0::0'] });
    expect(scorer.allValidExercisesHaveScores('0::0')).toBe(true);
  });

  it('empty_lesson_cannot_supersede', () => {
    const graph = createTestGraph([
      {
        id: '1',
        lessons: [
          { id: '1::0', exercises: 1 },
          {
            id: '1::1',
            dependencies: ['1::0'],
            superseded: ['1::0'],
            exercises: 0,
          },
        ],
      },
    ]);
    const { scorer, scoreExercise, clock } = createHarness({
      createScorer,
      graph,
    });
    scoreExercise('1::0::0', 5, clock.now());

    expect(scorer.allValidExercisesHaveScores('1::0')).toBe(true);
    expect(scorer.getUnitScore('1::1')).toBeNull();
    expect(scorer.isSuperseded('1::0', new Set(['1::1']))).toBe(false);
  });

  it('superseded_course_cached', () => {
    const { scorer, scoreAll, clock } = createHarness({ createScorer });
    scoreAll(5, clock.now());
    // Дважды: первый раз заполняет кэш, второй читает его.
    expect(scorer.getUnitScore('0')).toBeNull();
    expect(scorer.getUnitScore('0')).toBeNull();
  });

  it('superseded_course_lesson_cached', () => {
    const { scorer, scoreAll, clock } = createHarness({ createScorer });
    scoreAll(5, clock.now());
    expect(scorer.getUnitScore('1::0')).toBeNull();
    expect(scorer.getUnitScore('1::0')).toBeNull();
  });

  it('a superseded unit is not cached, so losing mastery of the superseding unit is seen', () => {
    const { scorer, scoreAll, scoreExercise, clock } = createHarness({
      createScorer,
    });
    scoreAll(5, clock.now());
    expect(scorer.getUnitScore('1::0')).toBeNull();
    expect(scorer.cacheKeys().lesson).not.toContain('1::0');

    // Вытесняющий урок 1::1 проваливается; кэш 1::0 не сбрасывался.
    clock.advance(1000);
    scoreExercise('1::1::0', 1, clock.now());
    scoreExercise('1::1::1', 1, clock.now());
    expect(scorer.getUnitScore('1::0')).not.toBeNull();
  });

  it('invalidate_cached_scores', () => {
    const graph = createTestGraph([
      { id: 'a', lessons: [{ id: 'a::a', exercises: 1 }] },
      { id: 'b', lessons: [{ id: 'b::a', exercises: 1 }] },
    ]);
    const { scorer, scoreAll, clock } = createHarness({ createScorer, graph });
    scoreAll(5, clock.now());
    for (const course of ['a', 'b']) {
      scorer.getUnitScore(course);
      scorer.getAvgTrials(course);
      scorer.getAvgTrials(`${course}::a`);
    }
    const filled = scorer.cacheKeys();
    expect(filled.exercise).toEqual(['a::a::0', 'b::a::0']);
    expect(filled.lesson).toEqual(['a::a', 'b::a']);
    expect(filled.course).toEqual(['a', 'b']);
    expect(filled.lessonTrials).toEqual(['a::a', 'b::a']);
    expect(filled.courseTrials).toEqual(['a', 'b']);

    // Ключи с префиксом уходят из всех пяти кэшей, остальные остаются.
    scorer.invalidateWithPrefix('a');
    const afterPrefix = scorer.cacheKeys();
    expect(afterPrefix.exercise).toEqual(['b::a::0']);
    expect(afterPrefix.lesson).toEqual(['b::a']);
    expect(afterPrefix.course).toEqual(['b']);
    expect(afterPrefix.lessonTrials).toEqual(['b::a']);
    expect(afterPrefix.courseTrials).toEqual(['b']);

    // Урок `b::a` уходит из всех кэшей вместе с курсом и своими упражнениями.
    scorer.invalidate(['b::a']);
    const empty = scorer.cacheKeys();
    expect(Object.values(empty).every((keys) => keys.length === 0)).toBe(true);
  });

  it('get_num_trials', () => {
    const { scorer, recordTrial } = createHarness({ createScorer });
    recordTrial('0::0::0', 4, 1000);
    recordTrial('0::0::0', 5, 2000);
    // Дважды: второй раз — из кэша.
    expect(scorer.getExerciseNumTrials('0::0::0')).toBe(2);
    expect(scorer.getExerciseNumTrials('0::0::0')).toBe(2);

    recordTrial('0::0::0', 4, 3000);
    scorer.invalidate(['0::0::0']);
    expect(scorer.getExerciseNumTrials('0::0::0')).toBe(3);
  });

  it('get_urgency', () => {
    const { scorer, scoreExercise, clock } = createHarness({ createScorer });
    clock.set(4 * DAY_MS);
    scoreExercise('0::0::0', 4, DAY_MS);
    scoreExercise('0::0::0', 5, 2 * DAY_MS);

    expect(scorer.cacheKeys().exercise).not.toContain('0::0::0');
    const initial = scorer.getExerciseUrgency('0::0::0');
    expect(scorer.cacheKeys().exercise).toContain('0::0::0');
    expect(scorer.getExerciseUrgency('0::0::0')).toBe(initial);

    // Ещё одна успешная попытка: срочность падает.
    scoreExercise('0::0::0', 5, 3 * DAY_MS);
    expect(scorer.getExerciseUrgency('0::0::0')).toBeLessThan(initial);
  });

  it('get_velocity', () => {
    const { scorer, scoreExercise, clock } = createHarness({ createScorer });
    clock.set(4 * DAY_MS);
    scoreExercise('0::0::0', 4, DAY_MS);
    scoreExercise('0::0::0', 5, 2 * DAY_MS);

    expect(scorer.cacheKeys().exercise).not.toContain('0::0::0');
    const initial = scorer.getExerciseVelocity('0::0::0');
    expect(scorer.cacheKeys().exercise).toContain('0::0::0');
    expect(scorer.getExerciseVelocity('0::0::0')).toBe(initial);

    // Более новая низкая оценка: наклон падает.
    scoreExercise('0::0::0', 4, 3 * DAY_MS);
    const updated = scorer.getExerciseVelocity('0::0::0');
    expect(updated as number).toBeLessThan(initial as number);
  });

  it('is_fresh: cache lives 2 h inclusive; a cachedAt in the future is stale', () => {
    const { scorer, scoreExercise, recordTrial, clock } = createHarness({
      createScorer,
    });
    scoreExercise('0::0::0', 5, clock.now());
    scoreExercise('0::0::0', 5, clock.now() + 1);
    expect(scorer.getExerciseNumTrials('0::0::0')).toBe(2);

    recordTrial('0::0::0', 5, clock.now() + 2); // без инвалидации
    clock.advance(MAX_CACHE_AGE_MS);
    expect(scorer.getExerciseNumTrials('0::0::0')).toBe(2);
    clock.advance(1);
    expect(scorer.getExerciseNumTrials('0::0::0')).toBe(3);

    recordTrial('0::0::0', 5, clock.now() + 1);
    clock.advance(-10);
    expect(scorer.getExerciseNumTrials('0::0::0')).toBe(4);
  });

  it('supersession chain: getSupersedingRecursive replaces mastered superseding units', () => {
    const graph = createTestGraph([
      {
        id: 'c',
        lessons: [
          { id: 'c::a', exercises: 1 },
          { id: 'c::b', superseded: ['c::a'], exercises: 1 },
          { id: 'c::c', superseded: ['c::b'], exercises: 1 },
        ],
      },
    ]);
    const { scorer, scoreExercise, clock } = createHarness({
      createScorer,
      graph,
    });
    scoreExercise('c::a::0', 5, clock.now());
    scoreExercise('c::b::0', 5, clock.now());

    // `c::c` пока без оценок: `c::b` не вытеснен, цепочка заканчивается на нём.
    expect(scorer.getSupersedingRecursive('c::a')).toEqual(new Set(['c::b']));
    expect(scorer.getSupersedingRecursive('c::c')).toBeNull();

    scoreExercise('c::c::0', 5, clock.now());
    expect(scorer.getSupersedingRecursive('c::a')).toEqual(new Set(['c::c']));
    expect(scorer.getUnitScore('c::a')).toBeNull();
    expect(scorer.getUnitScore('c::b')).toBeNull();
    expect(scorer.getUnitScore('c::c')).toBeGreaterThanOrEqual(4);
  });

  it('num_trials aggregates: lessons count zeros, blacklisted are skipped, no TTL', () => {
    const graph = createTestGraph([
      {
        id: 'c',
        lessons: [
          { id: 'c::a', exercises: 2 },
          { id: 'c::b', exercises: 1 },
        ],
      },
    ]);
    const { scorer, scoreExercise, blacklist, clock } = createHarness({
      createScorer,
      graph,
    });
    scoreExercise('c::a::0', 5, clock.now());
    scoreExercise('c::a::0', 5, clock.now() + 1);
    scoreExercise('c::b::0', 4, clock.now());

    expect(scorer.getAvgTrials('c::a')).toBe(1); // (2 + 0) / 2
    expect(scorer.getAvgTrials('c::b')).toBe(1);
    expect(scorer.getAvgTrials('c')).toBe(1);
    expect(scorer.getAvgTrials('c::a::0')).toBeNull();

    // Кэш агрегатов без срока жизни: сбрасывается только инвалидацией.
    blacklist.add('c::a::1');
    clock.advance(3 * MAX_CACHE_AGE_MS);
    expect(scorer.getAvgTrials('c::a')).toBe(1);
    scorer.invalidate(['c::a::0']);
    expect(scorer.getAvgTrials('c::a')).toBe(2);
  });

  it('invalidate cascades: exercise → lesson → course, lesson/course → exercises', () => {
    const { scorer, scoreAll, clock } = createHarness({ createScorer });
    const fill = () => {
      scoreAll(5, clock.now());
      scorer.getUnitScore('0');
      scorer.getAvgTrials('0');
      scorer.getUnitScore('0::1');
    };

    fill();
    scorer.invalidate(['0::0::0']);
    const afterExercise = scorer.cacheKeys();
    expect(afterExercise.exercise).not.toContain('0::0::0');
    expect(afterExercise.exercise).toContain('0::0::1'); // соседи не трогаются
    expect(afterExercise.lesson).not.toContain('0::0');
    expect(afterExercise.course).not.toContain('0');
    expect(afterExercise.courseTrials).not.toContain('0');
    expect(afterExercise.lesson).toContain('0::1');

    fill();
    scorer.invalidate(['0::1']);
    const afterLesson = scorer.cacheKeys();
    expect(afterLesson.exercise).not.toContain('0::1::0');
    expect(afterLesson.exercise).not.toContain('0::1::1');
    expect(afterLesson.exercise).toContain('0::0::0');
    expect(afterLesson.course).not.toContain('0');

    fill();
    scorer.invalidate(['0']);
    const afterCourse = scorer.cacheKeys();
    expect(afterCourse.exercise.filter((id) => id.startsWith('0::'))).toEqual(
      [],
    );
    expect(afterCourse.lesson.filter((id) => id.startsWith('0::'))).toEqual([]);
  });

  it('SchedulerOptions changes reach the scorer without recreating it', () => {
    const { scorer, options, recordTrial } = createHarness({ createScorer });
    for (let i = 0; i < 5; i++) recordTrial('0::0::0', 4, 1000 * (i + 1));
    expect(scorer.getExerciseNumTrials('0::0::0')).toBe(5);

    options.numTrials = 2;
    scorer.invalidate(['0::0::0']);
    expect(scorer.getExerciseNumTrials('0::0::0')).toBe(2);
    expect(scorer.getScorerInfo().numTrials).toBe(2);
  });

  it('supersedingScore from options decides the supersession', () => {
    const { scorer, options, scoreAll, clock } = createHarness({
      createScorer,
    });
    scoreAll(5, clock.now());
    expect(scorer.getUnitScore('0')).toBeNull(); // 5 >= 4: курс 0 вытеснен

    options.supersedingScore = 6; // недостижимо для шкалы 0..5
    expect(scorer.getUnitScore('0')).not.toBeNull();
  });

  it('getScorerInfo merges the scorer descriptor with numTrials', () => {
    const { scorer } = createHarness({ createScorer });
    const info = scorer.getScorerInfo();
    expect(info.numTrials).toBe(20);
    expect(['fsrs-hybrid', 'power-law']).toContain(info.kind);
    expect(info.parametersHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('getUnitScore of an unknown unit is a scoring error', () => {
    const { scorer } = createHarness({ createScorer });
    expect(() => scorer.getUnitScore('nope')).toThrow(UnknownUnitError);
    expect(() => scorer.getUnitScore('nope')).toThrow(ScoringError);
  });

  it('a course with no valid lesson scores is null and not cached; a blacklisted lesson is', () => {
    const { scorer } = createHarness({
      createScorer,
      blacklisted: ['0::0', '0::1'],
    });
    expect(scorer.getUnitScore('0')).toBeNull();
    expect(scorer.cacheKeys().course).not.toContain('0');
    expect(scorer.cacheKeys().lesson).toEqual(
      expect.arrayContaining(['0::0', '0::1']),
    );
  });

  it('an exercise without trials scores 0, so its lesson and course score 0', () => {
    const { scorer } = createHarness({ createScorer });
    expect(scorer.getUnitScore('0::0::0')).toBe(0);
    expect(scorer.getUnitScore('0::0')).toBe(0);
    expect(scorer.getUnitScore('0')).toBe(0);
    expect(scorer.cacheKeys().course).toContain('0');
  });
});

describe('UnitScorer rewards', () => {
  /** `c::l` охватывает `c::m`: хорошие оценки в `l` награждают `m`. */
  const graph = createTestGraph([
    {
      id: 'c',
      lessons: [
        { id: 'c::l', encompassed: [['c::m', 1.0]], exercises: 2 },
        { id: 'c::m', exercises: 1 },
      ],
    },
  ]);
  const createScorer = () =>
    createFsrsScorer({ memory: createTsFsrsMemoryModel() });
  const BASE = 1_800_000_000_000;

  const prepare = (grades: number[]) => {
    const harness = createHarness({ createScorer, graph });
    grades.forEach((grade, i) => {
      harness.recordTrial(
        'c::m::0',
        grade,
        BASE - (grades.length - i) * 2 * DAY_MS,
      );
    });
    return harness;
  };

  it('adds a positive reward to an exercise with >= 3 trials', () => {
    const plain = prepare([3, 3, 4]);
    const rewarded = prepare([3, 3, 4]);
    rewarded.scoreExercise('c::l::0', 5, BASE - DAY_MS);
    rewarded.scorer.invalidate(['c::m::0']);

    const base = plain.scorer.getUnitScore('c::m::0') as number;
    const boosted = rewarded.scorer.getUnitScore('c::m::0') as number;
    expect(boosted).toBeGreaterThan(base);
    expect(boosted).toBeLessThanOrEqual(5);
  });

  it('does not apply rewards below 3 trials', () => {
    const plain = prepare([3, 4]);
    const rewarded = prepare([3, 4]);
    rewarded.scoreExercise('c::l::0', 5, BASE - DAY_MS);
    rewarded.scorer.invalidate(['c::m::0']);
    expect(rewarded.scorer.getUnitScore('c::m::0')).toBe(
      plain.scorer.getUnitScore('c::m::0'),
    );
  });

  it('does not reward an exercise that is going badly (average < 3, recent)', () => {
    const plain = prepare([2, 2, 2]);
    const rewarded = prepare([2, 2, 2]);
    rewarded.scoreExercise('c::l::0', 5, BASE - DAY_MS);
    rewarded.scorer.invalidate(['c::m::0']);
    expect(rewarded.scorer.getUnitScore('c::m::0')).toBe(
      plain.scorer.getUnitScore('c::m::0'),
    );
  });
});

describe('UnitScorer scorer failures', () => {
  const graph = createTestGraph([
    { id: 'c', lessons: [{ id: 'c::l', exercises: 3 }] },
  ]);
  const inner = createPowerLawScorer();
  /** Скорер, отказывающий на одном упражнении (`Err` Trane) или падающий багом. */
  const failing = (failure: () => never): ExerciseScorer => ({
    info: inner.info,
    score: (type, trials, deltas, now) => {
      if (trials[0]?.score === 1) failure();
      return inner.score(type, trials, deltas, now);
    },
  });

  it('a ScoringError drops the exercise from lesson and course aggregates', () => {
    const exerciseScorer = failing(() => {
      throw new ScoringError('rejected');
    });
    const { scorer, scoreExercise, clock } = createHarness({
      createScorer: () => exerciseScorer,
      graph,
    });
    scoreExercise('c::l::0', 5, clock.now());
    scoreExercise('c::l::1', 1, clock.now()); // отказ скорера
    scoreExercise('c::l::2', 5, clock.now());

    expect(() => scorer.getUnitScore('c::l::1')).toThrow(ScoringError);
    expect(scorer.cacheKeys().exercise).not.toContain('c::l::1');
    expect(scorer.getUnitScore('c::l')).toBeCloseTo(5, 6);
    expect(scorer.getUnitScore('c')).toBeCloseTo(5, 6);
    expect(scorer.getExerciseNumTrials('c::l::0')).toBe(1);
    expect(scorer.getAvgTrials('c::l')).toBe(1); // отказавшее не входит
  });

  it('a programming error is not swallowed by the aggregates', () => {
    const exerciseScorer = failing(() => {
      throw new TypeError('bug');
    });
    const { scorer, scoreExercise, clock } = createHarness({
      createScorer: () => exerciseScorer,
      graph,
    });
    scoreExercise('c::l::1', 1, clock.now());
    expect(() => scorer.getUnitScore('c::l')).toThrow(TypeError);
  });
});

describe('UnitScorer exercise type', () => {
  it('passes the manifest type to the scorer and falls back to Procedural', () => {
    const seen: ExerciseType[] = [];
    const inner = createPowerLawScorer();
    const spy: ExerciseScorer = {
      info: inner.info,
      score: (type, trials, deltas, now) => {
        seen.push(type);
        return inner.score(type, trials, deltas, now);
      },
    };
    const types = new Map<string, ExerciseType>([['0::0::0', 'Declarative']]);
    const { scorer, recordTrial } = createHarness({
      createScorer: () => spy,
      types,
    });
    recordTrial('0::0::0', 5, 1000);
    recordTrial('0::0::1', 5, 1000);
    scorer.getUnitScore('0::0::0');
    scorer.getUnitScore('0::0::1');
    expect(seen).toEqual(['Declarative', 'Procedural']);
  });
});
