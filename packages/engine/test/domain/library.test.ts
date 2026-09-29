import { describe, expect, it } from 'vitest';
import { UnitGraphError } from '../../src/domain/graph.ts';
import { assembleLibrary } from '../../src/domain/library.ts';
import type {
  CourseManifest,
  ExerciseManifest,
  LessonManifest,
} from '../../src/domain/manifest.ts';

const course = (id: string, over: Partial<CourseManifest> = {}) =>
  ({
    id,
    name: '',
    dependencies: [],
    encompassed: [],
    superseded: [],
    description: null,
    authors: null,
    metadata: null,
    course_material: null,
    course_instructions: null,
    generator_config: null,
    ...over,
  }) satisfies CourseManifest;

const lesson = (
  id: string,
  courseId: string,
  over: Partial<LessonManifest> = {},
) =>
  ({
    id,
    dependencies: [],
    encompassed: [],
    superseded: [],
    course_id: courseId,
    name: '',
    description: null,
    metadata: null,
    lesson_material: null,
    lesson_instructions: null,
    ...over,
  }) satisfies LessonManifest;

const exercise = (id: string, lessonId: string, courseId: string) =>
  ({
    id,
    lesson_id: lessonId,
    course_id: courseId,
    name: '',
    description: null,
    exercise_type: 'Procedural',
    exercise_asset: { BasicAsset: { InlinedAsset: { content: id } } },
  }) satisfies ExerciseManifest;

const build = (cycleCheck = true) =>
  assembleLibrary(
    [course('b'), course('a'), course('a2', { dependencies: ['a'] })],
    [lesson('b::1', 'b'), lesson('a::2', 'a'), lesson('a::10', 'a')],
    [
      exercise('a::2::y', 'a::2', 'a'),
      exercise('a::2::x', 'a::2', 'a'),
      exercise('a::10::z', 'a::10', 'a'),
      exercise('b::1::q', 'b::1', 'b'),
    ],
    { cycleCheck },
  );

describe('assembleLibrary', () => {
  it('returns id lists sorted by code unit, regardless of insertion order', () => {
    const library = build();
    expect(library.getCourseIds()).toEqual(['a', 'a2', 'b']);
    expect(library.getLessonIds('a')).toEqual(['a::10', 'a::2']);
    expect(library.getExerciseIds('a::2')).toEqual(['a::2::x', 'a::2::y']);
    expect(library.getAllExerciseIds()).toEqual([
      'a::10::z',
      'a::2::x',
      'a::2::y',
      'b::1::q',
    ]);
  });

  it('getLessonIds / getExerciseIds are undefined without children', () => {
    const library = build();
    expect(library.getLessonIds('a2')).toBeUndefined();
    expect(library.getExerciseIds('b')).toBeUndefined();
  });

  it('getAllExerciseIds(unit) is scoped by unit type', () => {
    const library = build();
    expect(library.getAllExerciseIds('a')).toEqual([
      'a::10::z',
      'a::2::x',
      'a::2::y',
    ]);
    expect(library.getAllExerciseIds('a::10')).toEqual(['a::10::z']);
    expect(library.getAllExerciseIds('b::1::q')).toEqual(['b::1::q']);
    expect(library.getAllExerciseIds('nope')).toEqual([]);
  });

  it('getMatchingPrefix filters by prefix and optionally by unit type', () => {
    const library = build();
    expect([...library.getMatchingPrefix('a')].sort()).toEqual(
      ['a', 'a2', 'a::10', 'a::10::z', 'a::2', 'a::2::x', 'a::2::y'].sort(),
    );
    expect([...library.getMatchingPrefix('a', 'Course')].sort()).toEqual([
      'a',
      'a2',
    ]);
    expect([...library.getMatchingPrefix('a::', 'Lesson')].sort()).toEqual([
      'a::10',
      'a::2',
    ]);
    expect(library.getMatchingPrefix('zzz').size).toBe(0);
  });

  it('lookups return the manifests and hasExercise tells exercises only', () => {
    const library = build();
    expect(library.getCourse('a2')?.dependencies).toEqual(['a']);
    expect(library.getLesson('b::1')?.course_id).toBe('b');
    expect(library.getExercise('b::1::q')?.lesson_id).toBe('b::1');
    expect(library.hasExercise('b::1::q')).toBe(true);
    expect(library.hasExercise('b::1')).toBe(false);
    expect(library.getCourse('nope')).toBeUndefined();
  });

  it('the graph reflects manifest dependencies and starting lessons', () => {
    const library = build();
    expect([...(library.graph.getDependents('a') ?? [])]).toEqual(['a2']);
    expect([...(library.graph.getStartingLessons('a') ?? [])].sort()).toEqual([
      'a::10',
      'a::2',
    ]);
    expect(library.graph.getLessonCourse('a::2')).toBe('a');
  });

  it('encompassing equals dependency only when no manifest sets encompassed', () => {
    expect(build().graph.encompassingEqualsDependency()).toBe(true);
    const inCourse = assembleLibrary(
      [
        course('a'),
        course('b', { dependencies: ['a'], encompassed: [['a', 0.5]] }),
      ],
      [],
      [],
      { cycleCheck: true },
    );
    expect(inCourse.graph.encompassingEqualsDependency()).toBe(false);
    expect(inCourse.graph.getEncompasses('b')).toEqual([['a', 0.5]]);
    const inLesson = assembleLibrary(
      [course('a')],
      [
        lesson('a::1', 'a'),
        lesson('a::2', 'a', {
          dependencies: ['a::1'],
          encompassed: [['a::1', 0]],
        }),
      ],
      [],
      { cycleCheck: true },
    );
    expect(inLesson.graph.encompassingEqualsDependency()).toBe(false);
    expect(inLesson.graph.getEncompassedBy('a::1')).toEqual([['a::2', 0]]);
  });

  it('a course dependency with weights only in lessons still sees dependency weights in courses', () => {
    const library = assembleLibrary(
      [course('a'), course('b', { dependencies: ['a'] })],
      [lesson('a::1', 'a', { encompassed: [['b', 0.25]] })],
      [],
      { cycleCheck: true },
    );
    expect(library.graph.getEncompasses('b')).toEqual([['a', 1]]);
    expect(library.graph.getEncompasses('a::1')).toEqual([['b', 0.25]]);
  });

  it('duplicate ids across manifests raise UnitGraphError', () => {
    expect(() =>
      assembleLibrary([course('a'), course('a')], [], [], { cycleCheck: true }),
    ).toThrow(UnitGraphError);
    expect(() =>
      assembleLibrary([course('a')], [lesson('a', 'a')], [], {
        cycleCheck: true,
      }),
    ).toThrow(/lesson with ID a already exists/);
  });

  it('out-of-range weights fail regardless of cycleCheck', () => {
    const bad = [course('a', { encompassed: [['x', 1.5]] })];
    expect(() => assembleLibrary(bad, [], [], { cycleCheck: false })).toThrow(
      /weights within the range/,
    );
  });

  it('cycleCheck decides whether a cycle is reported', () => {
    const cyclic = [
      course('a', { dependencies: ['b'] }),
      course('b', { dependencies: ['a'] }),
    ];
    expect(() => assembleLibrary(cyclic, [], [], { cycleCheck: true })).toThrow(
      /cycle in dependency graph detected/,
    );
    expect(() =>
      assembleLibrary(cyclic, [], [], { cycleCheck: false }),
    ).not.toThrow();
  });

  it('the implicit lesson->course edge is not stored, explicit opposite edges are a cycle', () => {
    expect(() =>
      assembleLibrary(
        [course('c', { dependencies: ['c::1'] })],
        [lesson('c::1', 'c', { dependencies: ['c'] })],
        [],
        { cycleCheck: true },
      ),
    ).toThrow(/cycle in dependency graph/);
    expect(() =>
      assembleLibrary(
        [course('c')],
        [lesson('c::1', 'c', { dependencies: ['c'] })],
        [],
        { cycleCheck: true },
      ),
    ).not.toThrow();
  });
});
