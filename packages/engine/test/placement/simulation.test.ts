/**
 * Симуляция диагностики (T-48, порт `spike/diagnostic/src/sim.ts`): слоистые
 * DAG, случайные downset-ы, шум ответов. Полный прогон (20 учеников × 3
 * ширины) — `ENGINE_FULL_SIM=1`; по умолчанию облегчённый (тот же тест,
 * меньшая выборка и более широкий допуск).
 */
import { describe, expect, it } from 'vitest';
import { createDiagnosticSession } from '../../src/placement/index.ts';
import type { TopicGraph } from '../../src/placement/index.ts';
import {
  fixedNoiseOracle,
  layeredDag,
  metrics,
  mulberry32,
  randomDownset,
} from './helpers.ts';
import type { Metrics } from './helpers.ts';

const FULL = process.env.ENGINE_FULL_SIM === '1';
const LEARNERS = FULL ? 20 : 6;
const WIDTHS = [5, 15, 40] as const;
const BUDGET = 100;
const CHECKPOINTS = [10, 20, 40, 100] as const;

interface RunResult {
  byCheckpoint: Map<number, Metrics>;
  selectMs: number[];
  answerMs: number[];
}

interface RunOptions {
  slip: number;
  guess: number;
  noiseIndex: number;
  minPass?: number;
}

const graphs = new Map<string, TopicGraph>();
const dagOf = (size: number, width: number) => {
  const key = `${size}/${width}`;
  let graph = graphs.get(key);
  if (graph === undefined) {
    graph = layeredDag(size, width, mulberry32(size * 131 + width));
    graphs.set(key, graph);
  }
  return graph;
};

/** Один ученик: параметры спайка (seed downset-а, шума и сессии). */
const runLearner = (
  size: number,
  width: number,
  learner: number,
  { slip, guess, noiseIndex, minPass }: RunOptions,
): RunResult => {
  const graph = dagOf(size, width);
  const truth = randomDownset(
    graph,
    mulberry32(9000 + learner * 7 + size + width),
  );
  const noise = mulberry32(555 + learner * 31 + noiseIndex * 1009 + size);
  const draws = new Float64Array(size);
  for (let u = 0; u < size; u++) draws[u] = noise.next();
  const oracle = fixedNoiseOracle(truth, slip, guess, draws);
  const session = createDiagnosticSession(graph, {
    budget: BUDGET,
    seed: 17 + learner,
    ...(minPass === undefined ? {} : { minPass }),
  });
  const byCheckpoint = new Map<number, Metrics>();
  const selectMs: number[] = [];
  const answerMs: number[] = [];
  for (let k = 1; k <= BUDGET; k++) {
    const selectStart = performance.now();
    const topic = session.nextProbe();
    const selected = performance.now();
    if (topic !== null) {
      selectMs.push(selected - selectStart);
      session.answer(topic, oracle(topic));
      answerMs.push(performance.now() - selected);
    }
    if ((CHECKPOINTS as readonly number[]).includes(k)) {
      byCheckpoint.set(k, metrics(size, truth, session.classes()));
    }
  }
  return { byCheckpoint, selectMs, answerMs };
};

const mean = (values: readonly number[]) =>
  values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);

const report = (label: string, values: Record<string, number | string>) => {
  if (FULL) console.log(`[sim] ${label} ${JSON.stringify(values)}`);
};

describe('симуляция диагностики (T-48)', () => {
  it.each([200, 1000])(
    'без шума: ложных known нет ни в одной ячейке (N=%i)',
    (size) => {
      for (const width of WIDTHS) {
        for (let learner = 0; learner < LEARNERS; learner++) {
          const { byCheckpoint } = runLearner(size, width, learner, {
            slip: 0,
            guess: 0,
            noiseIndex: 0,
          });
          for (const [k, m] of byCheckpoint) {
            expect(
              m.falseKnown,
              `N=${size} w=${width} i=${learner} k=${k}`,
            ).toBe(0);
            expect(
              m.falseUnknown,
              `N=${size} w=${width} i=${learner} k=${k}`,
            ).toBe(0);
          }
        }
      }
    },
  );

  it('шум 3%, N=3000: accuracy на чекпоинтах не ниже спайка − допуск', () => {
    const SPIKE = { 10: 0.851, 20: 0.875, 40: 0.893, 100: 0.923 } as const;
    // облегчённый прогон — меньшая выборка, допуск шире
    const tolerance = FULL ? 0.02 : 0.05;
    const accuracy = new Map<number, number[]>();
    const select: number[] = [];
    const answer: number[] = [];
    for (const width of WIDTHS) {
      for (let learner = 0; learner < LEARNERS; learner++) {
        const result = runLearner(3000, width, learner, {
          slip: 0.03,
          guess: 0.03,
          noiseIndex: 1,
        });
        for (const [k, m] of result.byCheckpoint) {
          accuracy.set(k, [...(accuracy.get(k) ?? []), m.accuracy]);
        }
        select.push(...result.selectMs);
        answer.push(...result.answerMs);
      }
    }
    for (const k of CHECKPOINTS) {
      const value = mean(accuracy.get(k) as number[]);
      report(`acc@${k}`, { value: Number((value * 100).toFixed(2)) });
      expect(value).toBeGreaterThanOrEqual(SPIKE[k] - tolerance);
    }
    report('time', {
      selectMeanMs: Number(mean(select).toFixed(3)),
      selectMaxMs: Number(Math.max(...select).toFixed(3)),
      answerMeanMs: Number(mean(answer).toFixed(4)),
      answerMaxMs: Number(Math.max(...answer).toFixed(4)),
    });
    // цена пробы на N=3000 — единицы миллисекунд, не десятки
    expect(mean(select)).toBeLessThan(25);
  });

  it('шум 10%, N=3000, 40 проб: minPass=2 сильно снижает долю ложных known среди known', () => {
    const share = (minPass: number) => {
      const values: number[] = [];
      for (const width of WIDTHS) {
        for (let learner = 0; learner < LEARNERS; learner++) {
          const result = runLearner(3000, width, learner, {
            slip: 0.1,
            guess: 0.1,
            noiseIndex: 2,
            minPass,
          });
          values.push((result.byCheckpoint.get(40) as Metrics).fkShareOfKnown);
        }
      }
      return mean(values);
    };
    const without = share(0);
    const guarded = share(2);
    report('fk@40', {
      minPass0: Number((without * 100).toFixed(2)),
      minPass2: Number((guarded * 100).toFixed(2)),
    });
    expect(without).toBeGreaterThan(FULL ? 0.055 : 0.03);
    expect(without).toBeLessThan(FULL ? 0.1 : 0.15);
    expect(guarded).toBeLessThan(FULL ? 0.02 : 0.03);
    expect(guarded).toBeLessThan(without / 3);
  });
});
