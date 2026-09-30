/**
 * Golden L2: оценки юнитов (упражнение → урок → курс) после скриптовых
 * последовательностей попыток против настоящего Rust-Trane v0.34.1
 * (`golden-rs/src/bin/unit_score_l2_golden.rs`, fixture `unit-score-l2.jsonl`).
 *
 * Путь TS — настоящий: `practice.recordAttempt` через фасад → журнал →
 * проекции (`AttemptIndex`, награды по графу, флаги `blacklist`) →
 * `UnitScorer`. Три сверки на кейс:
 *   - `powerLaw`: `get_unit_score` всех юнитов Trane (PowerLaw зашит в его
 *     `UnitScorer`) против `createUnitScorer` с `PowerLawScorer` (f32-двойник) на
 *     проекциях движка. Продукционный движок считает упражнения FSRS-скорером,
 *     поэтому эта сверка собирает скорер сама, а проекции берёт у движка;
 *   - `rewards`: `get_rewards` каждого урока и курса против награды проекции;
 *   - `fsrs`: `practice.getUnitScore` настоящего движка против Rust-адаптера
 *     `fsrs-scorer` + награды настоящего Trane (сам Trane FSRS не хостит).
 * Дельты Trane в кейсах с ≥ 3 попыток на упражнение стёрты: порт их не имеет.
 * Допуски — `engine-ts-testing.md` §3: `|got − expected| ≤ atol`, дискретные
 * исходы (`null`/число, число и порядок наград, метки времени) — без допуска.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeClock } from '@dolphy-app/testkit';
import type { UnitId } from '@dolphy-app/engine-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNodeFsCourseSource } from '../../src/node/index.ts';
import {
  createPowerLawScorer,
  createUnitScorer,
} from '../../src/scoring/index.ts';
import type { UnitScorer } from '../../src/scoring/index.ts';
import { createCurrentScoringGraph } from '../../src/state/index.ts';
import { hashTree } from '../helpers/rust-dumps.ts';
import { createTestEngine } from '../helpers/engine.ts';
import type { TestEngine } from '../helpers/engine.ts';
import { L2_LIBRARIES } from './unit-score-l2-libraries.ts';

interface Header {
  nowMs: number;
  libraries: Record<
    string,
    { courses: number; lessons: number; exercises: number; treeSha256: string }
  >;
}

interface Case {
  id: string;
  library: string;
  blacklist: UnitId[];
  attempts: Array<{
    exerciseId: UnitId;
    score: 1 | 2 | 3 | 4 | 5;
    agoMs: number;
  }>;
  deltas: 'kept' | 'cleared';
  expect: {
    powerLaw: Record<UnitId, number | null>;
    rewards: Record<UnitId, Array<[number, number, number]>>;
    fsrs: Record<UnitId, number>;
  };
}

const [headerLine, ...caseLines] = readFileSync(
  fileURLToPath(new URL('./unit-score-l2.jsonl', import.meta.url)),
  'utf8',
)
  .split('\n')
  .filter(Boolean);
const fixture = {
  ...(JSON.parse(headerLine as string) as Header),
  cases: caseLines.map((line) => JSON.parse(line) as Case),
};

/**
 * Rust считает в f32, TS — в f64; допуск — `atol` из `engine-ts-testing.md` §3,
 * подобранный по измеренному максимуму на этом fixture (запас 4–6 раз):
 * оценки PowerLaw (f32-двойник, средние по юнитам) — максимум 4.8e-7 (1 ulp f32
 * у 4…5), награды — 8.7e-8, FSRS-упражнения — 6.2e-7.
 */
const SCORE_ATOL = 2e-6;
const REWARD_ATOL = 5e-7;
const FSRS_ATOL = 5e-6;

const roots = new Map<string, string>();
let tmp: string;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'unit-score-l2-'));
  for (const library of L2_LIBRARIES) {
    // копия: движок пишет артефакт компиляции рядом с библиотекой
    const source = await library.prepare(join(tmp, 'src'));
    const root = join(tmp, 'run', library.name);
    cpSync(source, root, { recursive: true });
    roots.set(library.name, root);
    const tree = await hashTree(source);
    expect(tree, library.name).toBe(
      fixture.libraries[library.name]?.treeSha256,
    );
  }
}, 120_000);

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const differs = (got: number, expected: number, atol: number) =>
  !(Math.abs(got - expected) <= atol);

interface Replayed {
  test: TestEngine;
  /** Перезапуск: новый движок на том же журнале (проекции перестроены, кэши пусты). */
  restarted: TestEngine;
  powerLaw: UnitScorer;
  /** То же, но без наград: показывает, что награды двигают оценку. */
  withoutRewards: UnitScorer;
}

/** Блэклист и попытки — через публичный API; время — часы, попытка — `at`. */
const replay = async (golden: Case): Promise<Replayed> => {
  const root = roots.get(golden.library) as string;
  const clock = createFakeClock(fixture.nowMs);
  const test = await createTestEngine({
    library: createNodeFsCourseSource(root),
    clock,
  });
  const { engine, ctx } = test;
  // флаги пишутся до первой попытки: запись «сейчас» сдвинула бы вперёд `at` всех
  // задним числом записанных попыток (правило HLC журнала)
  const oldest = Math.max(...golden.attempts.map(({ agoMs }) => agoMs), 0);
  clock.set(fixture.nowMs - oldest - 60_000);
  for (const unitId of golden.blacklist) {
    await engine.curation.blacklist.add(unitId);
  }
  for (const [index, attempt] of golden.attempts.entries()) {
    const at = fixture.nowMs - attempt.agoMs;
    clock.set(at);
    const result = await engine.practice.recordAttempt({
      requestId: `attempt-${index}`,
      exerciseId: attempt.exerciseId,
      grade: attempt.score,
      at,
    });
    expect(result.at, 'время попытки не сдвинуто журналом').toBe(at);
  }
  clock.set(fixture.nowMs);
  const restarted = await createTestEngine({
    library: createNodeFsCourseSource(root),
    clock,
    eventStore: test.eventStore,
  });

  const graph = createCurrentScoringGraph(
    () => ctx.library.current()?.library ?? null,
  );
  const scorerOver = (rewards: {
    getRewards: typeof ctx.projections.rewards.getRewards;
  }) =>
    createUnitScorer({
      clock,
      graph,
      blacklist: ctx.projections.flags,
      attempts: ctx.projections.attempts,
      rewards,
      exerciseTypeOf: (id) =>
        ctx.library.require().getExercise(id)?.exercise_type ?? null,
      exerciseScorer: createPowerLawScorer({ precision: 'f32' }),
      options: ctx.options.get,
    });
  return {
    test,
    restarted,
    powerLaw: scorerOver(ctx.projections.rewards),
    withoutRewards: scorerOver({ getRewards: () => [] }),
  };
};

/** Число оценок PowerLaw, сдвинутых наградами, по знаку сдвига. */
const rewardEffects = { positive: 0, negative: 0, cases: new Set<string>() };

describe('golden L2 get_unit_score vs Rust-Trane', () => {
  it('fixture has the documented shape', () => {
    const libraries = Object.keys(fixture.libraries);
    expect(libraries.sort()).toEqual(
      L2_LIBRARIES.map(({ name }) => name).sort(),
    );
    expect(libraries.length).toBeGreaterThanOrEqual(6);
    expect(fixture.cases.length).toBeGreaterThanOrEqual(60);
    for (const name of libraries) {
      const own = fixture.cases.filter((golden) => golden.library === name);
      const ids = own.map(({ id }) => id.split('/')[1]);
      expect(ids, name).toEqual(expect.arrayContaining(['empty', 'single']));
      expect(own.length, name).toBeGreaterThanOrEqual(5);
    }
    const scenarios = new Set(fixture.cases.map(({ id }) => id.split('/')[1]));
    for (const name of [
      'empty',
      'single',
      'mixed-grades',
      'repeats-days',
      'encompass-reward',
      'reward-refused',
      'encompass-penalty',
      'dense-history',
      'same-day',
      'superseded-mastered',
      'superseded-weak',
      'superseded-all-mastered',
      'superseded-partial',
      'superseded-course-mastered',
      'week-edge-positive',
      'week-edge-negative',
      'fan-in-dedup',
      'blacklist',
    ]) {
      expect(scenarios.has(name), name).toBe(true);
    }
    // Trane без правок (≤ 2 попыток на упражнение) и с удалёнными дельтами
    expect(new Set(fixture.cases.map(({ deltas }) => deltas))).toEqual(
      new Set(['kept', 'cleared']),
    );
  });

  describe.each(fixture.cases.map((golden) => [golden.id, golden] as const))(
    '%s',
    (_id, golden) => {
      let replayed: Replayed;
      beforeAll(async () => {
        replayed = await replay(golden);
      }, 120_000);

      it('get_unit_score of every unit equals Rust (PowerLaw)', () => {
        const problems: string[] = [];
        for (const [unitId, expected] of Object.entries(
          golden.expect.powerLaw,
        )) {
          const got = replayed.powerLaw.getUnitScore(unitId);
          if (expected === null || got === null) {
            if (expected !== got)
              problems.push(`${unitId}: ${got} ≠ ${expected}`);
          } else if (differs(got, expected, SCORE_ATOL)) {
            problems.push(`${unitId}: ${got} ≠ ${expected}`);
          }
          if (got !== null && expected !== null) {
            const bare = replayed.withoutRewards.getUnitScore(unitId);
            if (bare !== null && Math.abs(bare - got) > 1e-3) {
              rewardEffects.cases.add(golden.id);
              if (got > bare) rewardEffects.positive++;
              else rewardEffects.negative++;
            }
          }
        }
        expect(problems).toEqual([]);
        expect(Object.keys(golden.expect.powerLaw).length).toBeGreaterThan(0);
      });

      it.each(['test', 'restarted'] as const)(
        'rewards of lessons and courses equal Rust (%s)',
        (which) => {
          const { rewards } = replayed[which].ctx.projections;
          const library = replayed[which].ctx.library.require();
          const courseIds = library.getCourseIds();
          const units = [
            ...courseIds,
            ...courseIds.flatMap(
              (courseId) => library.getLessonIds(courseId) ?? [],
            ),
          ];
          const problems: string[] = [];
          for (const unitId of units) {
            const got = rewards.getRewards(unitId, 20);
            const expected = golden.expect.rewards[unitId] ?? [];
            if (got.length !== expected.length) {
              problems.push(
                `${unitId}: ${got.length} наград, ожидалось ${expected.length}`,
              );
              continue;
            }
            for (const [i, [value, weight, seconds]] of expected.entries()) {
              const reward = got[i]!;
              if (
                differs(reward.value, value, REWARD_ATOL) ||
                differs(reward.weight, weight, REWARD_ATOL) ||
                reward.timestamp !== seconds * 1000
              ) {
                problems.push(
                  `${unitId}[${i}]: ${JSON.stringify([reward.value, reward.weight, reward.timestamp])} ≠ ${JSON.stringify([value, weight, seconds * 1000])}`,
                );
              }
            }
          }
          expect(problems).toEqual([]);
        },
      );

      it('engine practice.getUnitScore (FSRS) equals adapter + Trane rewards', async () => {
        const { engine } = replayed.restarted;
        const problems: string[] = [];
        for (const [exerciseId, expected] of Object.entries(
          golden.expect.fsrs,
        )) {
          const { score } = await engine.practice.getUnitScore(exerciseId);
          if (score === null || differs(score, expected, FSRS_ATOL)) {
            problems.push(`${exerciseId}: ${score} ≠ ${expected}`);
          }
        }
        expect(problems).toEqual([]);
      });
    },
  );

  it('rewards move the scores in both directions (the fixture bites)', () => {
    expect(rewardEffects.positive).toBeGreaterThanOrEqual(10);
    expect(rewardEffects.negative).toBeGreaterThanOrEqual(10);
    expect(rewardEffects.cases.size).toBeGreaterThanOrEqual(10);
  });
});
