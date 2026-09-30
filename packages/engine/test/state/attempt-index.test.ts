import type { Grade } from '@dolphy-app/engine-contract';
import { buildAttempt, buildLibrary, T0_MS } from '@dolphy-app/testkit';
import { describe, expect, it } from 'vitest';
import { createAttemptIndex } from '../../src/state/attempt-index.ts';
import { createCurrentScoringGraph } from '../../src/state/current-graph.ts';
import { toLibrary } from './helpers.ts';

const library = toLibrary(
  buildLibrary({
    courses: [
      {
        id: 'c',
        lessons: [
          { id: 'l1', exercises: ['e1', 'e2'] },
          { id: 'l2', exercises: ['e3'] },
        ],
      },
    ],
  }),
);
const graph = createCurrentScoringGraph(() => library);
const E1 = 'c::l1::e1';
const E2 = 'c::l1::e2';
const E3 = 'c::l2::e3';

const attempt = (seq: number, exerciseId: string, grade: Grade = 3, at = seq) =>
  buildAttempt({ seq, exerciseId, grade, at: T0_MS + at * 1_000 });

const keyOf = (seq: number, at = seq, deviceId = 'device-a') => ({
  id: `${deviceId}-${seq}`,
  deviceId,
  seq,
  at: T0_MS + at * 1_000,
});

describe('AttemptIndex', () => {
  it('returns the newest trials first and limits the window, count sees all', () => {
    const index = createAttemptIndex(() => graph);
    for (let seq = 1; seq <= 25; seq++) index.applyAttempt(attempt(seq, E1));
    const trials = index.getTrials(E1, 20);
    expect(trials).toHaveLength(20);
    expect(trials[0]?.timestamp).toBe(T0_MS + 25_000);
    expect(trials[19]?.timestamp).toBe(T0_MS + 6_000);
    expect(index.getTrials(E1, 3).map((t) => t.timestamp)).toEqual([
      T0_MS + 25_000,
      T0_MS + 24_000,
      T0_MS + 23_000,
    ]);
    expect(index.count(E1)).toBe(25);
  });

  it('orders equal timestamps by deviceId, then seq (T-03)', () => {
    const index = createAttemptIndex(() => graph);
    index.applyAttempt(
      buildAttempt({ exerciseId: E1, deviceId: 'b', seq: 1, at: 5 }),
    );
    index.applyAttempt(
      buildAttempt({ exerciseId: E1, deviceId: 'a', seq: 2, at: 5 }),
    );
    index.applyAttempt(
      buildAttempt({ exerciseId: E1, deviceId: 'a', seq: 1, at: 5 }),
    );
    expect(
      index.getRecords(E1).map(({ deviceId, seq }) => `${deviceId}${seq}`),
    ).toEqual(['b1', 'a2', 'a1']);
  });

  it('applying the same attempt twice changes nothing', () => {
    const index = createAttemptIndex(() => graph);
    const first = attempt(1, E1);
    expect(index.applyAttempt(first)).toBe(true);
    expect(index.applyAttempt(first)).toBe(false);
    expect(index.count(E1)).toBe(1);
  });

  describe('progress_reset', () => {
    const fill = () => {
      const index = createAttemptIndex(() => graph);
      index.applyAttempt(attempt(1, E1));
      index.applyAttempt(attempt(2, E2));
      index.applyAttempt(attempt(3, E3));
      return index;
    };

    it('an ancestor reset covers descendants, a descendant reset does not cover the parent', () => {
      const lesson = fill();
      lesson.applyReset('c::l1', keyOf(4));
      expect([E1, E2, E3].map((id) => lesson.count(id))).toEqual([0, 0, 1]);

      const exercise = fill();
      exercise.applyReset(E1, keyOf(4));
      expect([E1, E2, E3].map((id) => exercise.count(id))).toEqual([0, 1, 1]);

      const course = fill();
      course.applyReset('c', keyOf(4));
      expect([E1, E2, E3].map((id) => course.count(id))).toEqual([0, 0, 0]);
      expect([...course.attemptedExerciseIds()]).toEqual([]);
    });

    it('attempts after the reset count; the later of two resets wins', () => {
      const index = fill();
      index.applyReset('c', keyOf(4));
      index.applyAttempt(attempt(5, E1));
      expect(index.count(E1)).toBe(1);
      index.applyReset(E1, keyOf(6));
      expect(index.count(E1)).toBe(0);
      expect(index.applyReset(E1, keyOf(4, 4))).toBe(false); // старый сброс ничего не меняет
      expect(index.cutOf(E1)).toEqual(keyOf(6));
    });

    it('a reset that arrives late cancels the attempts before its key only', () => {
      const index = createAttemptIndex(() => graph);
      index.applyAttempt(attempt(3, E1)); // после сброса по ключу
      index.applyAttempt(attempt(1, E1));
      index.applyReset(E1, keyOf(2));
      expect(index.getRecords(E1).map(({ seq }) => seq)).toEqual([3]);
    });

    it('a reset with the same at is ordered by deviceId and seq', () => {
      const index = createAttemptIndex(() => graph);
      index.applyAttempt(
        buildAttempt({ exerciseId: E1, deviceId: 'a', seq: 1, at: 10 }),
      );
      index.applyAttempt(
        buildAttempt({ exerciseId: E1, deviceId: 'c', seq: 1, at: 10 }),
      );
      index.applyReset(E1, { id: 'r', deviceId: 'b', seq: 1, at: 10 });
      // ключ сброса больше записи устройства `a`, но меньше записи устройства `c`
      expect(index.getRecords(E1).map(({ deviceId }) => deviceId)).toEqual([
        'c',
      ]);
    });

    it('depends on the course graph: moving the exercise changes the projection', () => {
      const moved = toLibrary(
        buildLibrary({
          courses: [
            {
              id: 'c',
              lessons: [
                { id: 'l1', exercises: ['e2'] },
                { id: 'l2', exercises: ['e3', 'e1'] },
              ],
            },
          ],
        }),
      );
      const movedGraph = createCurrentScoringGraph(() => moved);
      const journal = (index: ReturnType<typeof createAttemptIndex>) => {
        index.applyAttempt(attempt(1, E1));
        index.applyReset('c::l1', keyOf(2));
        return index.count(E1);
      };
      expect(journal(createAttemptIndex(() => graph))).toBe(0);
      expect(journal(createAttemptIndex(() => movedGraph))).toBe(1);
    });
  });

  it('remembers every unit id it has seen, including flags', () => {
    const index = createAttemptIndex(() => graph);
    index.applyAttempt(attempt(1, 'gone::exercise'));
    index.applyReset('gone::lesson', keyOf(2));
    index.noteUnit('gone::flagged');
    expect([...index.seenUnitIds()].sort()).toEqual([
      'gone::exercise',
      'gone::flagged',
      'gone::lesson',
    ]);
  });
});
