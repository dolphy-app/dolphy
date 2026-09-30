import { buildLibrary } from '@dolphy-app/testkit';
import { describe, expect, it } from 'vitest';
import { assembleLibrary } from '../../src/domain/library.ts';
import { buildPlacementTopics } from '../../src/placement/index.ts';
import type { TopicGraph } from '../../src/placement/index.ts';

const blacklistOf = (...ids: string[]) => ({
  isBlacklisted: (id: string) => ids.includes(id),
});

/** Курс c1: l1 ← l2(пуст) ← l3; l1 ← l4 ← l5; курс c2: x (зависит от c1::l3) ← y. */
const libraryWith = (verified: readonly string[] = []) => {
  const spec = buildLibrary({
    courses: [
      {
        id: 'c1',
        lessons: [
          { id: 'l1', exercises: ['e0', 'e1'] },
          { id: 'l2', dependencies: ['l1'], exercises: 0 },
          { id: 'l3', dependencies: ['l2'], exercises: ['e0'] },
          { id: 'l4', dependencies: ['l1'], exercises: ['e0', 'e1'] },
          { id: 'l5', dependencies: ['l4'], exercises: ['e0'] },
        ],
      },
      {
        id: 'c2',
        lessons: [
          { id: 'x', dependencies: ['c1::l3'], exercises: ['e0'] },
          { id: 'y', dependencies: ['x'], exercises: ['e0'] },
        ],
      },
    ],
  });
  const exercises = spec.exercises.map((exercise) =>
    verified.includes(exercise.id)
      ? { ...exercise, engine: { exercise: { type: 'dolphy.sql' } } }
      : exercise,
  );
  return assembleLibrary(spec.courses, spec.lessons, exercises, {
    cycleCheck: true,
  });
};

const prerequisitesByName = (graph: TopicGraph) =>
  Object.fromEntries(
    graph.ids.map((id, u) => [
      id,
      [
        ...graph.upTargets.subarray(graph.upOffsets[u], graph.upOffsets[u + 1]),
      ].map((p) => graph.ids[p]),
    ]),
  );

describe('buildPlacementTopics', () => {
  it('темы — уроки с упражнениями; пустой урок прозрачен для зависимых', () => {
    const topics = buildPlacementTopics(libraryWith());
    expect(topics.graph.ids).toEqual([
      'c1::l1',
      'c1::l3',
      'c1::l4',
      'c1::l5',
      'c2::x',
      'c2::y',
    ]);
    expect(prerequisitesByName(topics.graph)).toEqual({
      'c1::l1': [],
      'c1::l3': ['c1::l1'],
      'c1::l4': ['c1::l1'],
      'c1::l5': ['c1::l4'],
      'c2::x': ['c1::l3'],
      'c2::y': ['c2::x'],
    });
    expect(topics.exercises[0]).toEqual(['c1::l1::e0', 'c1::l1::e1']);
  });

  it('blacklist урока, его упражнений и курса сжимает граф', () => {
    const byLesson = buildPlacementTopics(libraryWith(), {
      blacklist: blacklistOf('c1::l4'),
    });
    expect(prerequisitesByName(byLesson.graph)['c1::l5']).toEqual(['c1::l1']);

    const byExercises = buildPlacementTopics(libraryWith(), {
      blacklist: blacklistOf('c1::l4::e0', 'c1::l4::e1'),
    });
    expect(byExercises.graph.ids).toEqual(byLesson.graph.ids);
    expect(prerequisitesByName(byExercises.graph)).toEqual(
      prerequisitesByName(byLesson.graph),
    );

    const partial = buildPlacementTopics(libraryWith(), {
      blacklist: blacklistOf('c1::l1::e0'),
    });
    expect(partial.exercises[0]).toEqual(['c1::l1::e1']);

    const byCourse = buildPlacementTopics(libraryWith(), {
      blacklist: blacklistOf('c1'),
    });
    expect(prerequisitesByName(byCourse.graph)).toEqual({
      'c2::x': [],
      'c2::y': ['c2::x'],
    });
  });

  it('цепочка прозрачных уроков раскрывается рекурсивно', () => {
    const topics = buildPlacementTopics(libraryWith(), {
      blacklist: blacklistOf('c1::l3', 'c1::l1'),
    });
    // l2 пуст, l3 и l1 закрыты: у x нет ни одной темы-пререквизита
    expect(prerequisitesByName(topics.graph)['c2::x']).toEqual([]);
  });

  it('выбор курсов: зависимости на уроки вне выбора игнорируются; пустой список — все курсы', () => {
    const only = buildPlacementTopics(libraryWith(), { courseIds: ['c2'] });
    expect(prerequisitesByName(only.graph)).toEqual({
      'c2::x': [],
      'c2::y': ['c2::x'],
    });
    expect(
      buildPlacementTopics(libraryWith(), { courseIds: [] }).graph.size,
    ).toBe(6);
    expect(
      buildPlacementTopics(libraryWith(), { courseIds: ['nope'] }).graph.size,
    ).toBe(0);
  });

  it('проба — упражнение с engine.exercise в приоритете, иначе первое по id', () => {
    const topics = buildPlacementTopics(
      libraryWith(['c1::l1::e1', 'c2::y::e0']),
    );
    const at = (id: string) => topics.graph.ids.indexOf(id);
    expect(topics.probeExercise[at('c1::l1')]).toBe('c1::l1::e1');
    expect(topics.verifiable[at('c1::l1')]).toBe(true);
    expect(topics.probeExercise[at('c1::l4')]).toBe('c1::l4::e0');
    expect(topics.verifiable[at('c1::l4')]).toBe(false);
    expect(topics.probeExercise[at('c2::y')]).toBe('c2::y::e0');
    expect(topics.verifiable[at('c2::y')]).toBe(true);
  });

  it('blacklisted упражнение с engine.exercise не становится пробой', () => {
    const topics = buildPlacementTopics(libraryWith(['c1::l1::e1']), {
      blacklist: blacklistOf('c1::l1::e1'),
    });
    expect(topics.probeExercise[0]).toBe('c1::l1::e0');
    expect(topics.verifiable[0]).toBe(false);
  });
});
