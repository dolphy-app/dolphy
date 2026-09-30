/**
 * Порт модульных тестов `scheduler/relearn_pile.rs` (mod tests, :70-110, 2
 * теста) и пробелов спеки: отбор не удаляет из пула, чистка blacklisted,
 * пул меньше `amount`, опции читаются при каждом выборе.
 *
 * Отличия от Rust: `RelearnPile::new(options)` хранил клон опций, порт берёт
 * их из единого источника при каждом выборе; `Rng` инжектируется, тесты
 * проверяют состав и длину, а не порядок.
 */
import type { SchedulerOptionsDto } from '@dolphy-app/engine-contract';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHEDULER_OPTIONS,
  createRelearnPile,
} from '../../src/scheduler/index.ts';
import type { RelearnPile } from '../../src/scheduler/index.ts';
import { createCountingRng } from './helpers/counting-rng.ts';

type PileOptions = Pick<SchedulerOptionsDto, 'batchSize' | 'relearnFraction'>;

const createPile = (
  options: () => PileOptions = () => DEFAULT_SCHEDULER_OPTIONS,
  precision: 'f32' | 'f64' = 'f64',
) => {
  const counting = createCountingRng(3);
  const pile = createRelearnPile({ options, rng: counting.rng, precision });
  return { pile, counting };
};

const fill = (pile: RelearnPile, count: number) => {
  for (let i = 0; i < count; i++) pile.update(`exercise_${i}`, 1);
};

const nobody = () => false;

describe('RelearnPile', () => {
  it('test_update: оценки 1–2 добавляют, 4–5 убирают', () => {
    const { pile } = createPile();
    pile.update('exercise_1', 1);
    pile.update('exercise_2', 2);
    pile.update('exercise_2', 1);
    expect(pile.has('exercise_1')).toBe(true);
    expect(pile.has('exercise_2')).toBe(true);
    expect(pile.size).toBe(2);

    pile.update('exercise_1', 4);
    pile.update('exercise_2', 5);
    expect(pile.has('exercise_1')).toBe(false);
    expect(pile.has('exercise_2')).toBe(false);
    expect(pile.size).toBe(0);
  });

  it('оценка 3 убирает упражнение; успех без записи в пуле ничего не делает', () => {
    const { pile } = createPile();
    pile.update('a', 2);
    pile.update('a', 3);
    expect(pile.has('a')).toBe(false);
    pile.update('never-failed', 5);
    expect(pile.entries()).toEqual([]);
  });

  it('test_add_to_batch: batchSize 10, доля 0.5, пул 20 → ровно 5', () => {
    const { pile, counting } = createPile(() => ({
      batchSize: 10,
      relearnFraction: 0.5,
    }));
    fill(pile, 20);
    const selected = pile.selectExercises(nobody);
    expect(selected).toHaveLength(5);
    const ids = selected.map((c) => c.exerciseId);
    expect(new Set(ids).size).toBe(5);
    for (const id of ids) expect(pile.has(id)).toBe(true);
    expect(counting.calls.sample).toBe(1);
    expect(counting.total()).toBe(1);
  });

  it('кандидаты пула создаются только с exerciseId', () => {
    const { pile } = createPile(() => ({ batchSize: 10, relearnFraction: 1 }));
    pile.update('only', 1);
    const [candidate] = pile.selectExercises(nobody);
    expect(candidate).toEqual({
      exerciseId: 'only',
      lessonId: '',
      courseId: '',
      depth: 0,
      exerciseScore: 0,
      frequency: 0,
      urgency: 0,
      velocity: null,
      deadEnd: false,
      encompassesWeight: 0,
      encompassedWeight: 0,
    });
  });

  it('отбор не уменьшает пул: повторный выбор берёт из того же набора', () => {
    const { pile } = createPile(() => ({
      batchSize: 10,
      relearnFraction: 0.5,
    }));
    fill(pile, 20);
    pile.selectExercises(nobody);
    pile.selectExercises(nobody);
    expect(pile.size).toBe(20);
  });

  it('пул меньше amount: возвращаются все, пул сохраняется', () => {
    const { pile } = createPile(() => ({
      batchSize: 50,
      relearnFraction: 0.5,
    }));
    fill(pile, 3);
    const selected = pile.selectExercises(nobody);
    expect(selected.map((c) => c.exerciseId).sort()).toEqual([
      'exercise_0',
      'exercise_1',
      'exercise_2',
    ]);
    expect(pile.size).toBe(3);
  });

  it('пустой пул и amount = 0 дают пустой выбор', () => {
    const { pile } = createPile(() => ({
      batchSize: 10,
      relearnFraction: 0.5,
    }));
    expect(pile.selectExercises(nobody)).toEqual([]);
    const zero = createPile(() => ({ batchSize: 10, relearnFraction: 0 }));
    fill(zero.pile, 5);
    expect(zero.pile.selectExercises(nobody)).toEqual([]);
    expect(zero.pile.size).toBe(5);
  });

  it('чистка blacklisted: упражнения из blacklist удаляются из пула и не попадают в выбор', () => {
    const { pile } = createPile(() => ({ batchSize: 10, relearnFraction: 1 }));
    fill(pile, 6);
    const blocked = new Set(['exercise_1', 'exercise_4']);
    const selected = pile.selectExercises((id) => blocked.has(id));
    expect(selected.map((c) => c.exerciseId).sort()).toEqual([
      'exercise_0',
      'exercise_2',
      'exercise_3',
      'exercise_5',
    ]);
    expect(pile.has('exercise_1')).toBe(false);
    expect(pile.has('exercise_4')).toBe(false);
    expect(pile.size).toBe(4);
  });

  it('batchSize и relearnFraction читаются из источника опций при каждом выборе', () => {
    let options: PileOptions = { batchSize: 10, relearnFraction: 0.5 };
    const { pile } = createPile(() => options);
    fill(pile, 40);
    expect(pile.selectExercises(nobody)).toHaveLength(5);
    options = { batchSize: 20, relearnFraction: 0.5 };
    expect(pile.selectExercises(nobody)).toHaveLength(10);
    options = { batchSize: 20, relearnFraction: 0.25 };
    expect(pile.selectExercises(nobody)).toHaveLength(5);
  });

  it('amount усекается: 10 × 0.25 = 2.5 → 2', () => {
    const { pile } = createPile(() => ({
      batchSize: 10,
      relearnFraction: 0.25,
    }));
    fill(pile, 10);
    expect(pile.selectExercises(nobody)).toHaveLength(2);
  });

  it('f32: 50 × 0.1 даёт 5, как Rust', () => {
    const { pile } = createPile(
      () => ({ batchSize: 50, relearnFraction: 0.1 }),
      'f32',
    );
    fill(pile, 20);
    expect(pile.selectExercises(nobody)).toHaveLength(5);
  });

  it('clear опустошает пул', () => {
    const { pile } = createPile();
    fill(pile, 4);
    pile.clear();
    expect(pile.size).toBe(0);
    expect(pile.entries()).toEqual([]);
  });
});
