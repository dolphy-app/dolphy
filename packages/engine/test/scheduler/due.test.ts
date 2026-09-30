/**
 * `getDue` (engine-ts-api.md §4): упражнения с состоянием памяти и
 * `R ≤ plan.targetRetention`, по убыванию `need = 1 − R`. Проверяются
 * свойства выдачи (порог, порядок, монотонность по времени), а не числа FSRS.
 */
import type { Grade, UnitId } from '@spirula/engine-contract';
import { describe, expect, it } from 'vitest';
import { retrievabilityAt } from '../../src/scheduler/index.ts';
import { type World, createWorld } from './helpers/world.ts';

const DAY_MS = 86_400_000;

const courses = () => [
  {
    id: '0',
    lessons: [
      { id: '0::0', exercises: 3 },
      { id: '0::1', exercises: 2 },
    ],
  },
  { id: '1', lessons: [{ id: '1::0', exercises: 2 }] },
];

const ALL_EXERCISES: readonly UnitId[] = [
  '0::0::0',
  '0::0::1',
  '0::0::2',
  '0::1::0',
  '0::1::1',
  '1::0::0',
  '1::0::1',
];

const practiceAll = (world: World, grade: Grade = 4) => {
  for (const id of ALL_EXERCISES) world.record(id, grade);
};

describe('getDue', () => {
  it('без попыток пусто; свежая попытка (R ≈ 1) ещё не просрочена', () => {
    const world = createWorld({ courses: courses() });
    expect(world.getDue()).toEqual([]);
    practiceAll(world);
    expect(world.getDue()).toEqual([]);
  });

  it('просроченные идут по убыванию need; R ≤ targetRetention и need = 1 − R', () => {
    const world = createWorld({ courses: courses(), scorer: 'fsrs' });
    practiceAll(world, 5);
    world.clock.advance(1 * DAY_MS);
    world.record('0::0::0', 1);
    world.clock.advance(20 * DAY_MS);
    const due = world.getDue();
    expect(due.length).toBeGreaterThan(0);
    for (const item of due) {
      expect(item.retrievability).toBeLessThanOrEqual(0.9);
      expect(item.need).toBeCloseTo(1 - item.retrievability, 12);
    }
    const needs = due.map((item) => item.need);
    expect(needs).toEqual([...needs].sort((a, b) => b - a));
  });

  it('провальное упражнение забывается быстрее и стоит выше в очереди', () => {
    const world = createWorld({ courses: courses(), scorer: 'fsrs' });
    world.options.set({ plan: { targetRetention: 0.99 } });
    world.record('0::0::0', 1);
    world.record('0::0::1', 5);
    world.clock.advance(3 * DAY_MS);
    const ids = world.getDue().map((item) => item.exerciseId);
    expect(ids).toEqual(['0::0::0', '0::0::1']);
  });

  it('со временем очередь только растёт (монотонность R по времени)', () => {
    const world = createWorld({ courses: courses(), scorer: 'fsrs' });
    practiceAll(world, 4);
    const sizes: number[] = [];
    for (let day = 0; day < 8; day++) {
      sizes.push(world.getDue().length);
      world.clock.advance(30 * DAY_MS);
    }
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(sizes.at(-1)).toBe(ALL_EXERCISES.length);
  });

  it('targetRetention из опций сдвигает порог, minNeed отсекает по need', () => {
    const world = createWorld({ courses: courses(), scorer: 'fsrs' });
    for (const id of ALL_EXERCISES) {
      world.record(id, 4);
      world.clock.advance(DAY_MS);
    }
    world.clock.advance(10 * DAY_MS);
    world.options.set({ plan: { targetRetention: 0.5 } });
    const strict = world.getDue().length;
    world.options.set({ plan: { targetRetention: 0.99 } });
    const lenient = world.getDue();
    expect(lenient.length).toBeGreaterThan(strict);
    const median = lenient[Math.floor(lenient.length / 2)]?.need as number;
    const filtered = world.getDue({ minNeed: median });
    expect(filtered.length).toBeLessThan(lenient.length);
    expect(filtered.every((item) => item.need >= median)).toBe(true);
  });

  it('lastAttemptAt — время новейшей попытки, lessonId — урок упражнения', () => {
    const world = createWorld({ courses: courses(), scorer: 'fsrs' });
    world.options.set({ plan: { targetRetention: 0.99 } });
    world.record('1::0::1', 4);
    world.clock.advance(1000);
    const secondAt = world.clock.now();
    world.record('1::0::1', 4);
    world.clock.advance(2 * DAY_MS);
    const [item] = world.getDue();
    expect(item).toMatchObject({
      exerciseId: '1::0::1',
      lessonId: '1::0',
      lastAttemptAt: secondAt,
    });
    expect(item?.score).toBeGreaterThan(0);
  });

  it('blacklist исключает упражнение, урок и курс целиком', () => {
    const world = createWorld({ courses: courses(), scorer: 'fsrs' });
    practiceAll(world, 3);
    world.clock.advance(400 * DAY_MS);
    const idsOf = () => new Set(world.getDue().map((item) => item.exerciseId));
    expect(idsOf().size).toBe(ALL_EXERCISES.length);
    world.blacklist.add('0::0::0');
    expect(idsOf().has('0::0::0')).toBe(false);
    world.blacklist.add('0::1');
    expect(idsOf().has('0::1::0')).toBe(false);
    world.blacklist.add('1');
    expect([...idsOf()].sort()).toEqual(['0::0::1', '0::0::2']);
  });

  it('упражнения, которых нет в библиотеке, пропускаются', () => {
    const world = createWorld({ courses: courses(), scorer: 'fsrs' });
    world.record('9::9::9', 4);
    world.record('0::0::0', 4);
    world.clock.advance(400 * DAY_MS);
    expect(world.getDue().map((item) => item.exerciseId)).toEqual(['0::0::0']);
  });

  it('не меняет состояние', () => {
    const world = createWorld({ courses: courses(), scorer: 'fsrs' });
    practiceAll(world, 3);
    world.clock.advance(400 * DAY_MS);
    expect(world.getDue()).toEqual(world.getDue());
    expect(world.session.trialCounts()).toEqual({
      success: ALL_EXERCISES.length,
      failed: 0,
    });
  });
});

describe('retrievabilityAt', () => {
  const model = {
    retrievability: (_state: unknown, days: number) => 1 / (1 + days),
  };
  const memory = { state: { stability: 1, difficulty: 5 }, lastAt: 1_000_000 };

  it('считает дробные сутки с последней попытки', () => {
    expect(retrievabilityAt(model, memory, 1_000_000 + DAY_MS)).toBeCloseTo(
      0.5,
    );
    expect(retrievabilityAt(model, memory, 1_000_000 + DAY_MS / 2)).toBeCloseTo(
      1 / 1.5,
    );
  });

  it('время до последней попытки не даёт R > 1: возраст неотрицателен', () => {
    expect(retrievabilityAt(model, memory, 0)).toBe(1);
  });

  it('нечисловой и выходящий за [0, 1] ответ модели приводится к диапазону', () => {
    const at = memory.lastAt + DAY_MS;
    expect(
      retrievabilityAt({ retrievability: () => Number.NaN }, memory, at),
    ).toBe(0);
    expect(retrievabilityAt({ retrievability: () => 1.5 }, memory, at)).toBe(1);
    expect(retrievabilityAt({ retrievability: () => -0.5 }, memory, at)).toBe(
      0,
    );
  });
});
