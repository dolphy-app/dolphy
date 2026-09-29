import { describe, expect, it } from 'vitest';
import {
  assetPathsOf,
  InvalidAssetPathError,
  normalizeCourseManifest,
  normalizeExerciseManifest,
  normalizeLessonManifest,
  normalizePath,
  resolveAssetPath,
} from '../../src/domain/asset-path.ts';
import type {
  CourseManifest,
  ExerciseAsset,
  ExerciseManifest,
  LessonManifest,
} from '../../src/domain/manifest.ts';
import { parseExerciseManifest } from '../../src/domain/manifest-schema.ts';

const exerciseWith = (asset: ExerciseAsset): ExerciseManifest => ({
  id: 'c::l::e',
  lesson_id: 'c::l',
  course_id: 'c',
  name: '',
  description: null,
  exercise_type: 'Procedural',
  exercise_asset: asset,
});

const course = (over: Partial<CourseManifest> = {}): CourseManifest => ({
  id: 'c',
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
});

const lesson = (over: Partial<LessonManifest> = {}): LessonManifest => ({
  id: 'c::l',
  dependencies: [],
  encompassed: [],
  superseded: [],
  course_id: 'c',
  name: '',
  description: null,
  metadata: null,
  lesson_material: null,
  lesson_instructions: null,
  ...over,
});

/** Аналог `verify_paths` Trane над набором существующих файлов. */
const verifyPaths = (
  m: CourseManifest | LessonManifest | ExerciseManifest,
  dir: string,
  files: readonly string[],
): boolean => {
  let normalized: CourseManifest | LessonManifest | ExerciseManifest;
  if ('exercise_asset' in m) normalized = normalizeExerciseManifest(m, dir);
  else if ('lesson_material' in m) normalized = normalizeLessonManifest(m, dir);
  else normalized = normalizeCourseManifest(m, dir);
  return assetPathsOf(normalized).every((path) => files.includes(path));
};

describe('resolveAssetPath (vfs 0.13 join_internal)', () => {
  it.each([
    ['c1', 'm.md', 'c1/m.md', false],
    ['c1/sub', '../x.md', 'c1/x.md', false],
    ['c1', './a/./b.md', 'c1/a/b.md', false],
    ['c1', 'a//b.md', 'c1/a/b.md', false],
    ['', 'a.md', 'a.md', false],
    ['c1', '', 'c1', false],
    ['c1', '/', '', false],
    ['c1/sub', '/x.md', 'x.md', false],
    ['c1', '../x.md', 'x.md', false],
    ['c1', '../../x.md', 'x.md', true],
    ['c1', '/../x.md', 'x.md', true],
    ['', '..', '', true],
  ])('(%j, %j) -> %j, escapes %j', (dir, path, expected, escapes) => {
    expect(resolveAssetPath(dir, path)).toEqual({ path: expected, escapes });
  });

  it.each(['d/', 'a/b/', './'])(
    'a trailing slash after a longer path (%j) is an InvalidAssetPathError',
    (path) => {
      expect(() => resolveAssetPath('c1', path)).toThrow(InvalidAssetPathError);
    },
  );
});

describe('normalizePath (data.rs normalize_path)', () => {
  it('normalize_good_path: asset.md in course/ -> course/asset.md', () => {
    expect(normalizePath('', 'course', 'asset.md')).toBe('course/asset.md');
    expect(normalizePath('/', '/course', 'asset.md')).toBe('course/asset.md');
  });

  it('normalize_path_trims_library_root_prefix', () => {
    expect(normalizePath('/library', '/library/course', 'asset.md')).toBe(
      'course/asset.md',
    );
    expect(normalizePath('/library/', '/library/course', 'asset.md')).toBe(
      'course/asset.md',
    );
  });

  it('normalize_absolute_path: /absolute/path -> absolute/path', () => {
    expect(normalizePath('/', '/course', '/absolute/path')).toBe(
      'absolute/path',
    );
  });

  it('normalize_bad_path: ../../outside leaves /library', () => {
    expect(() =>
      normalizePath('/library', '/library/course', '../../outside'),
    ).toThrow(/outside the library root/);
  });

  it('normalize_path_rejects_root_prefix_collision', () => {
    expect(() =>
      normalizePath('/library', '/library_backup', 'asset.md'),
    ).toThrow(/outside the library root/);
  });

  it('the library root itself is a valid target', () => {
    expect(normalizePath('/library', '/library/course', '..')).toBe('');
  });
});

describe('NormalizePaths by manifest type', () => {
  it('soundslice_normalize_paths: backup None is untouched, /backup -> backup', () => {
    const slice = (backup: string | null): ExerciseAsset => ({
      SoundSliceAsset: { link: 'https://s/', description: 'Test', backup },
    });
    expect(
      normalizeExerciseManifest(exerciseWith(slice(null)), 'course')
        .exercise_asset,
    ).toEqual(slice(null));
    expect(
      normalizeExerciseManifest(exerciseWith(slice('/backup')), 'course')
        .exercise_asset,
    ).toEqual(slice('backup'));
    expect(
      normalizeExerciseManifest(exerciseWith(slice('b.xml')), 'course')
        .exercise_asset,
    ).toEqual(slice('course/b.xml'));
  });

  it('flashcard front and back are resolved against the manifest dir', () => {
    const normalized = normalizeExerciseManifest(
      exerciseWith({
        FlashcardAsset: { front_path: 'f.md', back_path: '../b.md' },
      }),
      'c/l',
    );
    expect(normalized.exercise_asset).toEqual({
      FlashcardAsset: { front_path: 'c/l/f.md', back_path: 'c/b.md' },
    });
  });

  it('only MarkdownAsset paths of BasicAsset change', () => {
    const md = exerciseWith({
      BasicAsset: { MarkdownAsset: { path: 'q.md' } },
    });
    expect(normalizeExerciseManifest(md, 'c/l').exercise_asset).toEqual({
      BasicAsset: { MarkdownAsset: { path: 'c/l/q.md' } },
    });
    const inlined: ExerciseAsset[] = [
      { BasicAsset: { InlinedAsset: { content: 'a/../b' } } },
      { InlineFlashcardAsset: { front_content: 'F', back_content: 'B' } },
      {
        LiteracyAsset: { lesson_type: 'Reading', examples: [], exceptions: [] },
      },
      { TranscriptionAsset: { content: 'x/y', external_link: null } },
    ];
    for (const asset of inlined) {
      expect(
        normalizeExerciseManifest(exerciseWith(asset), 'c').exercise_asset,
      ).toEqual(asset);
    }
  });

  it('course and lesson normalize material and instructions only', () => {
    const c = course({
      name: 'a/../b',
      course_material: { MarkdownAsset: { path: 'm.md' } },
      course_instructions: { InlinedAsset: { content: 'i' } },
    });
    expect(normalizeCourseManifest(c, 'c')).toEqual({
      ...c,
      course_material: { MarkdownAsset: { path: 'c/m.md' } },
    });
    const l = lesson({
      lesson_material: { MarkdownAsset: { path: '/root.md' } },
      lesson_instructions: { MarkdownAsset: { path: 'i.md' } },
    });
    expect(normalizeLessonManifest(l, 'c/l.lesson')).toEqual({
      ...l,
      lesson_material: { MarkdownAsset: { path: 'root.md' } },
      lesson_instructions: { MarkdownAsset: { path: 'c/l.lesson/i.md' } },
    });
  });

  it('does not mutate its input and does not need the files to exist', () => {
    const input = exerciseWith({
      FlashcardAsset: { front_path: 'missing.md', back_path: null },
    });
    const snapshot = structuredClone(input);
    normalizeExerciseManifest(input, 'c');
    expect(input).toEqual(snapshot);
  });

  it('a path with a trailing slash makes normalization throw', () => {
    const bad = exerciseWith({
      FlashcardAsset: { front_path: 'dir/', back_path: null },
    });
    expect(() => normalizeExerciseManifest(bad, 'c')).toThrow(
      InvalidAssetPathError,
    );
  });

  it('a normalized manifest still parses through the schema', () => {
    const normalized = normalizeExerciseManifest(
      exerciseWith({
        FlashcardAsset: { front_path: 'f.md', back_path: null },
      }),
      'c',
    );
    expect(parseExerciseManifest(normalized).ok).toBe(true);
  });
});

describe('verify paths (assetPathsOf over normalized manifests)', () => {
  const slice = (backup: string | null): ExerciseManifest =>
    exerciseWith({
      SoundSliceAsset: { link: 'https://s/', description: null, backup },
    });

  it('soundslice_verify_paths: no backup is fine, a missing ./bad_file is not', () => {
    expect(verifyPaths(slice(null), '', [])).toBe(true);
    expect(verifyPaths(slice('./bad_file'), '', [])).toBe(false);
    expect(verifyPaths(slice('./bad_file'), '', ['bad_file'])).toBe(true);
  });

  it('flashcard_verify_paths: front only, front and back, inline', () => {
    const files = ['c/front.md', 'c/back.md'];
    const front = exerciseWith({
      FlashcardAsset: { front_path: 'front.md', back_path: null },
    });
    const both = exerciseWith({
      FlashcardAsset: { front_path: 'front.md', back_path: 'back.md' },
    });
    const missingBack = exerciseWith({
      FlashcardAsset: { front_path: 'front.md', back_path: 'nope.md' },
    });
    const inline = exerciseWith({
      InlineFlashcardAsset: { front_content: 'F', back_content: 'B' },
    });
    expect(verifyPaths(front, 'c', files)).toBe(true);
    expect(verifyPaths(both, 'c', files)).toBe(true);
    expect(verifyPaths(missingBack, 'c', files)).toBe(false);
    expect(verifyPaths(inline, 'c', [])).toBe(true);
  });

  it('literacy_verify_paths: a Literacy asset has no file paths', () => {
    const literacy = exerciseWith({
      LiteracyAsset: {
        lesson_type: 'Reading',
        examples: [
          ['C', null],
          ['D', 'd'],
        ],
        exceptions: [['E', null]],
      },
    });
    expect(assetPathsOf(literacy)).toEqual([]);
  });

  it('course and lesson list instructions before material, skipping inlined', () => {
    expect(
      assetPathsOf(
        course({
          course_material: { MarkdownAsset: { path: 'm' } },
          course_instructions: { MarkdownAsset: { path: 'i' } },
        }),
      ),
    ).toEqual(['i', 'm']);
    expect(
      assetPathsOf(
        lesson({
          lesson_material: { InlinedAsset: { content: 'x' } },
          lesson_instructions: { MarkdownAsset: { path: 'i' } },
        }),
      ),
    ).toEqual(['i']);
  });
});
