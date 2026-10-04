import type { GraphQuery } from '@dolphy-app/engine-contract';
import {
  buildCourse,
  buildExercise,
  buildLesson,
  createFakeExerciseTypes,
  createFakeExtensionPolicy,
} from '@dolphy-app/testkit';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXERCISE_TIMEOUT_MS,
  EngineError,
  toCourseDto,
  toExerciseDto as toExerciseDtoWith,
  toGraphDto,
  toLessonDto,
  toUnitDto,
} from '../../src/app/index.ts';
import { assembleLibrary } from '../../src/domain/library.ts';
import type {
  ExerciseAsset,
  ExerciseManifest,
} from '../../src/domain/manifest.ts';

const noTypes = createFakeExerciseTypes();
const policy = createFakeExtensionPolicy();
const toExerciseDto = (exercise: ExerciseManifest) =>
  toExerciseDtoWith(exercise, noTypes, policy);

const exerciseWith = (exerciseAsset: ExerciseAsset, id = 'a::l0::e0') =>
  buildExercise({ id, exercise_asset: exerciseAsset });

const sampleLibrary = () =>
  assembleLibrary(
    [
      buildCourse({ id: 'a', encompassed: [], dependencies: [] }),
      buildCourse({ id: 'b', dependencies: ['a'] }),
    ],
    [
      buildLesson({ id: 'a::l0' }),
      buildLesson({
        id: 'a::l1',
        dependencies: ['a::l0'],
        encompassed: [['a::l0', 0.5]],
      }),
      buildLesson({ id: 'b::l0', superseded: ['a::l1'] }),
    ],
    [
      buildExercise({ id: 'a::l0::e0' }),
      buildExercise({ id: 'a::l0::e1' }),
      buildExercise({ id: 'a::l1::e0' }),
      buildExercise({ id: 'b::l0::e0' }),
    ],
    { cycleCheck: true },
  );

const graph = (query: GraphQuery = {}) => toGraphDto(sampleLibrary(), query);

const catchError = (run: () => unknown): EngineError => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(EngineError);
    return error as EngineError;
  }
  return expect.unreachable('an error was expected');
};

describe('toCourseDto / toLessonDto', () => {
  it('omits absent fields and replaces null metadata with an empty record', () => {
    const dto = toCourseDto(buildCourse({ id: 'a' }), 3);
    expect(dto).toEqual({
      kind: 'course',
      id: 'a',
      name: 'Course a',
      metadata: {},
      dependencies: [],
      encompassed: [],
      superseded: [],
      lessonCount: 3,
    });
    expect('description' in dto).toBe(false);
    expect('authors' in dto).toBe(false);
    expect('material' in dto).toBe(false);
  });

  it('copies fields and links only file assets', () => {
    const course = buildCourse({
      id: 'a',
      description: 'About',
      authors: ['Ann'],
      metadata: { tags: ['x', 'y'] },
      dependencies: ['z'],
      encompassed: [['z', 0.25]],
      superseded: ['y'],
      course_material: { MarkdownAsset: { path: 'a/material.md' } },
      course_instructions: { InlinedAsset: { content: 'inline' } },
    });
    const dto = toCourseDto(course, 1);
    expect(dto).toMatchObject({
      description: 'About',
      authors: ['Ann'],
      metadata: { tags: ['x', 'y'] },
      dependencies: ['z'],
      encompassed: [{ id: 'z', weight: 0.25 }],
      superseded: ['y'],
      material: { unitId: 'a', path: 'a/material.md' },
    });
    expect('instructions' in dto).toBe(false);
    dto.metadata.tags?.push('mutated');
    expect(course.metadata?.tags).toEqual(['x', 'y']);
  });

  it('maps lessons with parent course and exercise count', () => {
    const dto = toLessonDto(
      buildLesson({
        id: 'a::l0',
        lesson_instructions: { MarkdownAsset: { path: 'a/l0/i.md' } },
        lesson_material: { InlinedUniqueAsset: { content: 'm' } },
      }),
      2,
    );
    expect(dto).toEqual({
      kind: 'lesson',
      id: 'a::l0',
      name: 'Lesson a::l0',
      metadata: {},
      dependencies: [],
      encompassed: [],
      superseded: [],
      courseId: 'a',
      exerciseCount: 2,
      instructions: { unitId: 'a::l0', path: 'a/l0/i.md' },
    });
  });
});

describe('toExerciseDto', () => {
  it('maps flashcards to asset refs, omitting an absent back', () => {
    expect(
      toExerciseDto(
        exerciseWith({
          FlashcardAsset: { front_path: 'f.md', back_path: 'b.md' },
        }),
      ).content,
    ).toEqual({
      type: 'flashcard',
      front: { unitId: 'a::l0::e0', path: 'f.md' },
      back: { unitId: 'a::l0::e0', path: 'b.md' },
    });
    const single = toExerciseDto(
      exerciseWith({ FlashcardAsset: { front_path: 'f.md', back_path: null } }),
    ).content;
    expect(single).toEqual({
      type: 'flashcard',
      front: { unitId: 'a::l0::e0', path: 'f.md' },
    });
    expect('back' in single).toBe(false);
  });

  it('maps inline flashcards', () => {
    expect(
      toExerciseDto(
        exerciseWith({
          InlineFlashcardAsset: { front_content: 'Q', back_content: 'A' },
        }),
      ).content,
    ).toEqual({ type: 'inlineFlashcard', front: 'Q', back: 'A' });
    const single = toExerciseDto(
      exerciseWith({
        InlineFlashcardAsset: { front_content: 'Q', back_content: null },
      }),
    ).content;
    expect(single).toEqual({ type: 'inlineFlashcard', front: 'Q' });
    expect('back' in single).toBe(false);
  });

  it('maps basic assets to markdown or inlineMarkdown', () => {
    const content = (asset: ExerciseAsset) =>
      toExerciseDto(exerciseWith(asset)).content;
    expect(
      content({ BasicAsset: { MarkdownAsset: { path: 'q.md' } } }),
    ).toEqual({
      type: 'markdown',
      ref: { unitId: 'a::l0::e0', path: 'q.md' },
    });
    expect(
      content({ BasicAsset: { InlinedAsset: { content: '# Q' } } }),
    ).toEqual({ type: 'inlineMarkdown', text: '# Q' });
    expect(
      content({ BasicAsset: { InlinedUniqueAsset: { content: '# U' } } }),
    ).toEqual({ type: 'inlineMarkdown', text: '# U' });
  });

  it.each<[string, ExerciseAsset]>([
    [
      'LiteracyAsset',
      {
        LiteracyAsset: {
          lesson_type: 'Reading',
          examples: [['a', null]],
          exceptions: [],
        },
      },
    ],
    [
      'SoundSliceAsset',
      {
        SoundSliceAsset: { link: 'https://x', description: null, backup: null },
      },
    ],
    [
      'TranscriptionAsset',
      { TranscriptionAsset: { content: 'c', external_link: null } },
    ],
  ])('shows an explanation instead of unsupported %s', (kind, asset) => {
    expect(toExerciseDto(exerciseWith(asset)).content).toEqual({
      type: 'inlineMarkdown',
      text: `This exercise uses ${kind}, which the engine does not support.`,
    });
  });

  it('maps type, description and key prerequisites', () => {
    const dto = toExerciseDto(
      buildExercise({
        id: 'a::l0::e0',
        exercise_type: 'Procedural',
        description: 'Solve it',
        engine: { keyPrerequisites: ['a::l0::e1'] },
      }),
    );
    expect(dto).toMatchObject({
      kind: 'exercise',
      id: 'a::l0::e0',
      lessonId: 'a::l0',
      courseId: 'a',
      exerciseType: 'procedural',
      description: 'Solve it',
      keyPrerequisites: ['a::l0::e1'],
    });
    const plain = toExerciseDto(buildExercise({ id: 'a::l0::e0' }));
    expect(plain.exerciseType).toBe('declarative');
    expect(plain.keyPrerequisites).toEqual([]);
    expect('description' in plain).toBe(false);
    expect('task' in plain).toBe(false);
  });

  it('describes the task from the exercise type catalog', () => {
    const types = createFakeExerciseTypes({
      types: { 'dolphy.sql': { element: 'dolphy-sql-answer' } },
    });
    const dto = toExerciseDtoWith(
      buildExercise({
        id: 'a::l0::e0',
        engine: {
          exercise: {
            type: 'dolphy.sql',
            timeoutMs: 500,
            spec: { fixture: 'fx' },
          },
        },
      }),
      types,
      policy,
    );
    expect(dto.task).toEqual({
      type: 'dolphy.sql',
      timeoutMs: 500,
      element: 'dolphy-sql-answer',
      rendererUrl: 'dolphy-ext://fake/dolphy.sql.mjs',
      isolated: true,
      origin: 'user',
      revision: 'rev-0',
    });
  });

  it('marks the task isolated unless the owner is bundled or trusted', () => {
    const types = createFakeExerciseTypes({
      types: { 'dolphy.sql': {} },
    });
    const exercise = buildExercise({
      id: 'a::l0::e0',
      engine: { exercise: { type: 'dolphy.sql' } },
    });
    const flag = (p: typeof policy) =>
      toExerciseDtoWith(exercise, types, p).task?.isolated;
    expect(flag(createFakeExtensionPolicy())).toBe(true);
    expect(flag(createFakeExtensionPolicy({ bundled: ['dolphy.sql'] }))).toBe(
      false,
    );
    expect(
      flag(
        createFakeExtensionPolicy({
          settings: {
            disabled: [],
            trusted: ['dolphy.sql'],
            checkUpdates: true,
            safeMode: false,
          },
        }),
      ),
    ).toBe(false);
  });

  it('defaults the task timeout to 2000 ms', () => {
    const types = createFakeExerciseTypes({ types: { 'dolphy.sql': {} } });
    const dto = toExerciseDtoWith(
      buildExercise({
        id: 'a::l0::e0',
        engine: { exercise: { type: 'dolphy.sql' } },
      }),
      types,
      policy,
    );
    expect(dto.task?.timeoutMs).toBe(DEFAULT_EXERCISE_TIMEOUT_MS);
    expect(DEFAULT_EXERCISE_TIMEOUT_MS).toBe(2000);
  });

  it('omits the task when the type is not in the catalog', () => {
    const dto = toExerciseDto(
      buildExercise({
        id: 'a::l0::e0',
        engine: { exercise: { type: 'gone.type' } },
      }),
    );
    expect('task' in dto).toBe(false);
  });
});

describe('toUnitDto', () => {
  it('resolves units of every kind with counts from the graph', () => {
    const library = sampleLibrary();
    expect(toUnitDto(library, 'a', noTypes, policy)).toMatchObject({
      kind: 'course',
      lessonCount: 2,
    });
    expect(toUnitDto(library, 'a::l0', noTypes, policy)).toMatchObject({
      kind: 'lesson',
      exerciseCount: 2,
    });
    expect(toUnitDto(library, 'a::l1::e0', noTypes, policy)).toMatchObject({
      kind: 'exercise',
    });
  });

  it('unknown id is NOT_FOUND', () => {
    expect(
      catchError(() => toUnitDto(sampleLibrary(), 'nope', noTypes, policy))
        .code,
    ).toBe('NOT_FOUND');
  });
});

describe('toGraphDto', () => {
  it('lists every unit sorted by id with parents and manifest edges', () => {
    const dto = graph();
    expect(dto.truncated).toBe(false);
    expect(dto.nodes.map(({ id }) => id)).toEqual([
      'a',
      'a::l0',
      'a::l0::e0',
      'a::l0::e1',
      'a::l1',
      'a::l1::e0',
      'b',
      'b::l0',
      'b::l0::e0',
    ]);
    expect(dto.nodes.find(({ id }) => id === 'a')).toEqual({
      id: 'a',
      kind: 'course',
      name: 'Course a',
    });
    expect(dto.nodes.find(({ id }) => id === 'a::l1::e0')).toMatchObject({
      kind: 'exercise',
      parentId: 'a::l1',
    });
    expect(dto.edges).toEqual([
      { from: 'a::l1', to: 'a::l0', type: 'dependency' },
      { from: 'a::l1', to: 'a::l0', type: 'encompassed', weight: 0.5 },
      { from: 'b', to: 'a', type: 'dependency' },
      { from: 'b::l0', to: 'a::l1', type: 'superseded' },
    ]);
  });

  it('truncates to limit, keeping only edges between remaining nodes', () => {
    const dto = graph({ limit: 3 });
    expect(dto.truncated).toBe(true);
    expect(dto.nodes.map(({ id }) => id)).toEqual(['a', 'a::l0', 'a::l0::e0']);
    expect(dto.edges).toEqual([]);
    expect(graph({ limit: 9 }).truncated).toBe(false);
  });

  it('filters by kinds', () => {
    const dto = graph({ kinds: ['course'] });
    expect(dto.nodes.map(({ id }) => id)).toEqual(['a', 'b']);
    expect(dto.edges).toEqual([{ from: 'b', to: 'a', type: 'dependency' }]);
  });

  it('returns the neighbourhood of rootIds within depth', () => {
    expect(
      graph({ rootIds: ['a::l1'], depth: 0 }).nodes.map(({ id }) => id),
    ).toEqual(['a::l1']);
    expect(
      graph({ rootIds: ['a::l1'], depth: 1 }).nodes.map(({ id }) => id),
    ).toEqual(['a', 'a::l0', 'a::l1', 'a::l1::e0', 'b::l0']);
  });

  it('follows the whole connected part without depth', () => {
    expect(graph({ rootIds: ['b::l0::e0'] }).nodes).toHaveLength(9);
  });

  it('rejects unknown roots and invalid arguments', () => {
    expect(catchError(() => graph({ rootIds: ['nope'] })).code).toBe(
      'NOT_FOUND',
    );
    for (const query of [
      { limit: 0 },
      { limit: 2001 },
      { limit: 1.5 },
      { depth: -1 },
      { depth: 0.5 },
      { kinds: ['unit' as 'course'] },
    ]) {
      expect(catchError(() => graph(query)).code).toBe('INVALID_ARGUMENT');
    }
  });
});
