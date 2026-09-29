import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  encodeCourseManifest,
  encodeExerciseManifest,
  encodeLessonManifest,
  encodeUserPreferences,
  findUnknownKeys,
  parseCourseManifest,
  parseEncompassedList,
  parseExerciseManifest,
  parseExerciseType,
  parseKbString,
  parseLessonManifest,
  parseMetadata,
  parseStringList,
  parseUserPreferences,
  stringifyManifest,
} from '../../src/domain/manifest-schema.ts';
import type { ParseResult } from '../../src/domain/manifest-schema.ts';
import { TRANE_LIBRARIES } from '../helpers/fixtures.ts';

const ok = <T>(result: ParseResult<T>): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
};

const issuesOf = <T>(result: ParseResult<T>) => {
  if (result.ok) throw new Error('expected a schema failure');
  return result.issues;
};

const exercise = (asset: unknown, extra: object = {}) => ({
  id: 'c::l::e',
  lesson_id: 'c::l',
  course_id: 'c',
  exercise_asset: asset,
  ...extra,
});

const ASSET_VARIANTS: Record<string, unknown> = {
  MarkdownAsset: { BasicAsset: { MarkdownAsset: { path: 'm.md' } } },
  InlinedAsset: { BasicAsset: { InlinedAsset: { content: 'x' } } },
  InlinedUniqueAsset: { BasicAsset: { InlinedUniqueAsset: { content: 'x' } } },
  FlashcardAsset: { FlashcardAsset: { front_path: 'f.md', back_path: 'b.md' } },
  FlashcardNoBack: { FlashcardAsset: { front_path: 'f.md', back_path: null } },
  InlineFlashcardAsset: {
    InlineFlashcardAsset: { front_content: 'F', back_content: null },
  },
  LiteracyAsset: {
    LiteracyAsset: {
      lesson_type: 'Reading',
      examples: [
        ['a', null],
        ['b', 'B'],
      ],
      exceptions: [],
    },
  },
  SoundSliceAsset: {
    SoundSliceAsset: {
      link: 'https://www.soundslice.com/slices/QfZcc/',
      description: 'd',
      backup: null,
    },
  },
  TranscriptionAsset: {
    TranscriptionAsset: {
      content: 'c',
      external_link: { YouTube: 'https://youtu.be/x' },
    },
  },
};

const GENERATORS: Record<string, unknown> = {
  KnowledgeBase: { KnowledgeBase: { inlined: true } },
  Literacy: {
    Literacy: { generate_dictation: true, exercise_type: 'Declarative' },
  },
  Transcription: {
    Transcription: {
      transcription_dependencies: ['dep'],
      passage_directory: 'passages',
      inlined_passages: [
        {
          asset: {
            Track: {
              short_id: 't1',
              track_name: 'Track',
              artist_name: 'Artist',
              album_name: null,
              duration: '3:20',
              external_link: { YouTube: 'https://youtu.be/y' },
            },
          },
          intervals: { '0': ['0:10', '0:20'], '12': ['1:00', '1:30'] },
        },
      ],
      skip_singing_lessons: true,
      skip_advanced_lessons: false,
    },
  },
};

describe('wire round-trip (T-18)', () => {
  it.each(Object.entries(ASSET_VARIANTS))(
    'exercise asset %s: parse -> encode -> parse is stable',
    (_name, asset) => {
      const first = ok(parseExerciseManifest(exercise(asset)));
      expect(first.exercise_asset).toEqual(asset);
      const wire = JSON.parse(stringifyManifest(encodeExerciseManifest(first)));
      expect(ok(parseExerciseManifest(wire))).toEqual(first);
    },
  );

  it.each(Object.entries(GENERATORS))(
    'course generator %s: parse -> encode -> parse is stable',
    (_name, generator) => {
      const first = ok(
        parseCourseManifest({ id: 'c', generator_config: generator }),
      );
      expect(first.generator_config).toEqual(generator);
      const wire = JSON.parse(stringifyManifest(encodeCourseManifest(first)));
      expect(ok(parseCourseManifest(wire))).toEqual(first);
    },
  );

  it('lesson round-trips with assets, metadata and weighted encompassing', () => {
    const lesson = {
      id: 'c::l',
      dependencies: ['c::a', 'c::a'],
      encompassed: [['c::a', 0.5]],
      superseded: ['c::old'],
      course_id: 'c',
      name: 'L',
      description: 'd',
      metadata: { k: ['v'] },
      lesson_material: { InlinedAsset: { content: 'x' } },
      lesson_instructions: { MarkdownAsset: { path: 'i.md' } },
    };
    const parsed = ok(parseLessonManifest(lesson));
    expect(parsed).toEqual(lesson);
    expect(encodeLessonManifest(parsed)).toEqual(lesson);
  });

  it('UserPreferences round-trips including transcription', () => {
    const prefs = {
      transcription: {
        instruments: [{ name: 'Piano', id: 'piano' }],
        download_path: '/dl',
        download_path_alias: null,
      },
      scheduler: { batch_size: 20 },
      ignored_paths: ['a/b'],
    };
    const parsed = ok(parseUserPreferences(prefs));
    expect(parsed).toEqual(prefs);
    expect(encodeUserPreferences(parsed)).toEqual(prefs);
  });
});

describe('defaults and permissive parts of the wire format', () => {
  it('{} is a valid UserPreferences with serde defaults', () => {
    expect(ok(parseUserPreferences({}))).toEqual({
      transcription: null,
      scheduler: null,
      ignored_paths: [],
    });
  });

  it('minimal course gets #[serde(default)] values', () => {
    expect(ok(parseCourseManifest({ id: 'c' }))).toEqual({
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
    });
  });

  it('exercise_type defaults to Procedural, name to empty string', () => {
    const parsed = ok(
      parseExerciseManifest(
        exercise({ BasicAsset: { InlinedAsset: { content: 'x' } } }),
      ),
    );
    expect(parsed.exercise_type).toBe('Procedural');
    expect(parsed.name).toBe('');
  });

  it('back_path omitted means null; TranscriptionAsset {} is valid', () => {
    const flash = ok(
      parseExerciseManifest(exercise({ FlashcardAsset: { front_path: 'f' } })),
    );
    expect(flash.exercise_asset).toEqual({
      FlashcardAsset: { front_path: 'f', back_path: null },
    });
    const transcription = ok(
      parseExerciseManifest(exercise({ TranscriptionAsset: {} })),
    );
    expect(transcription.exercise_asset).toEqual({
      TranscriptionAsset: { content: '', external_link: null },
    });
  });

  it('KnowledgeBase: {} parses with inlined = false', () => {
    const parsed = ok(
      parseCourseManifest({
        id: 'c',
        generator_config: { KnowledgeBase: {} },
      }),
    );
    expect(parsed.generator_config).toEqual({
      KnowledgeBase: { inlined: false },
    });
  });

  it('unknown keys are stripped at every level', () => {
    const parsed = ok(
      parseCourseManifest({
        id: 'c',
        bogus: 1,
        engine: { tags: ['x'] },
        course_material: { MarkdownAsset: { path: 'm', extra: true } },
      }),
    );
    expect(parsed).not.toHaveProperty('bogus');
    expect(parsed).not.toHaveProperty('engine');
    expect(parsed.course_material).toEqual({ MarkdownAsset: { path: 'm' } });
  });

  it('encompassed weight range is not checked by the schema', () => {
    const parsed = ok(
      parseLessonManifest({
        id: 'l',
        course_id: 'c',
        encompassed: [['x', 1.5]],
      }),
    );
    expect(parsed.encompassed).toEqual([['x', 1.5]]);
  });

  it('findUnknownKeys reports keys outside the manifest, keeping engine known', () => {
    expect(
      findUnknownKeys('course', { id: 'c', engine: {}, tags: [], zzz: 1 }),
    ).toEqual(['tags', 'zzz']);
    expect(
      findUnknownKeys('exercise', { exercise_asset: {}, extra: 1 }),
    ).toEqual(['extra']);
  });
});

describe('rejections', () => {
  it('null for a non-Option field fails and points at the field', () => {
    const issues = issuesOf(
      parseCourseManifest({ id: 'c', dependencies: null }),
    );
    expect(issues.map((i) => i.path)).toEqual(['dependencies']);
  });

  it('unknown variant fails, lists the allowed ones and gives the path', () => {
    const issues = issuesOf(
      parseExerciseManifest(exercise({ SqlAsset: { q: 1 } })),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('exercise_asset');
    for (const name of [
      'SqlAsset',
      'BasicAsset',
      'FlashcardAsset',
      'InlineFlashcardAsset',
      'LiteracyAsset',
      'SoundSliceAsset',
      'TranscriptionAsset',
    ]) {
      expect(issues[0]?.message).toContain(name);
    }
  });

  it('an enum wrapper with two keys is rejected even in non-strict mode', () => {
    const asset = {
      FlashcardAsset: { front_path: 'f' },
      InlineFlashcardAsset: { front_content: 'F' },
    };
    const issues = issuesOf(parseExerciseManifest(exercise(asset)));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('exercise_asset');
  });

  it('flat form {"MarkdownAsset":"m.md"} is rejected with the payload path', () => {
    const issues = issuesOf(
      parseCourseManifest({
        id: 'c',
        course_material: { MarkdownAsset: 'm.md' },
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('course_material.MarkdownAsset');
  });

  it('a missing exercise_asset fails at exercise_asset', () => {
    const issues = issuesOf(
      parseExerciseManifest({ id: 'e', lesson_id: 'l', course_id: 'c' }),
    );
    expect(issues.map((i) => i.path)).toEqual(['exercise_asset']);
  });

  it.each([
    ['length 1', [['a']]],
    ['length 3', [['a', 1, 2]]],
    ['object form', [{ id: 'a', weight: 1 }]],
  ])('encompassed tuple with %s is rejected', (_name, encompassed) => {
    const issues = issuesOf(
      parseLessonManifest({ id: 'l', course_id: 'c', encompassed }),
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.path.startsWith('encompassed[0]'))).toBe(true);
  });

  it.each(['procedural', 'Procedural ', 'DECLARATIVE', 1, null])(
    'exercise_type %j is rejected (case matters, null is not an Option)',
    (value) => {
      const asset = { BasicAsset: { InlinedAsset: { content: 'x' } } };
      const issues = issuesOf(
        parseExerciseManifest(exercise(asset, { exercise_type: value })),
      );
      expect(issues.map((i) => i.path)).toEqual(['exercise_type']);
    },
  );

  it('required id is reported when missing or of the wrong type', () => {
    expect(issuesOf(parseCourseManifest({})).map((i) => i.path)).toEqual([
      'id',
    ]);
    expect(issuesOf(parseCourseManifest({ id: 1 })).map((i) => i.path)).toEqual(
      ['id'],
    );
  });

  it('non-object roots fail at (root)', () => {
    expect(issuesOf(parseCourseManifest(null))[0]?.path).toBe('(root)');
    expect(issuesOf(parseUserPreferences([]))[0]?.path).toBe('(root)');
  });

  it('interval keys must be decimal digits', () => {
    const generator = structuredClone(GENERATORS.Transcription) as {
      Transcription: { inlined_passages: { intervals: object }[] };
    };
    generator.Transcription.inlined_passages[0]!.intervals = {
      x: ['a', 'b'],
    };
    const result = parseCourseManifest({
      id: 'c',
      generator_config: generator,
    });
    expect(result.ok).toBe(false);
  });

  it('scheduler batch_size must be a non-negative integer', () => {
    expect(parseUserPreferences({ scheduler: { batch_size: 1.5 } }).ok).toBe(
      false,
    );
    expect(parseUserPreferences({ scheduler: { batch_size: -1 } }).ok).toBe(
      false,
    );
    expect(parseUserPreferences({ scheduler: {} }).ok).toBe(true);
  });

  it('no issue ever mentions invalid_union', () => {
    const bad = [
      exercise({ SqlAsset: {} }),
      exercise({ FlashcardAsset: 1 }),
      exercise('BasicAsset'),
      exercise({ BasicAsset: { MarkdownAsset: 'x' } }),
      exercise({}),
    ];
    for (const raw of bad) {
      const issues = issuesOf(parseExerciseManifest(raw));
      expect(issues.length).toBeGreaterThan(0);
      expect(JSON.stringify(issues)).not.toMatch(/union/i);
    }
  });
});

describe('knowledge base file parsers', () => {
  it('accept the shapes of lesson.*.json and reject others', () => {
    expect(ok(parseStringList(['a', 'b']))).toEqual(['a', 'b']);
    expect(parseStringList([1]).ok).toBe(false);
    expect(ok(parseEncompassedList([['a', 0.5]]))).toEqual([['a', 0.5]]);
    expect(parseEncompassedList([['a']]).ok).toBe(false);
    expect(ok(parseMetadata({ topic: ['adv'] }))).toEqual({ topic: ['adv'] });
    expect(parseMetadata({ topic: 'adv' }).ok).toBe(false);
    expect(ok(parseKbString('Introduction'))).toBe('Introduction');
    expect(parseKbString(1).ok).toBe(false);
    expect(ok(parseExerciseType('Declarative'))).toBe('Declarative');
    expect(parseExerciseType('Weird').ok).toBe(false);
  });
});

describe('encoders', () => {
  it('course keys follow serde declaration order, engine goes last', () => {
    const course = ok(parseCourseManifest({ id: 'c' }));
    const encoded = encodeCourseManifest({
      ...course,
      engine: { tags: ['t'] },
    });
    expect(Object.keys(encoded)).toEqual([
      'id',
      'name',
      'dependencies',
      'encompassed',
      'superseded',
      'description',
      'authors',
      'metadata',
      'course_material',
      'course_instructions',
      'generator_config',
      'engine',
    ]);
    expect(Object.keys(encodeCourseManifest(course))).not.toContain('engine');
  });

  it('lesson and exercise keys follow serde order; Option is written as null', () => {
    const lesson = ok(parseLessonManifest({ id: 'l', course_id: 'c' }));
    expect(Object.keys(encodeLessonManifest(lesson))).toEqual([
      'id',
      'dependencies',
      'encompassed',
      'superseded',
      'course_id',
      'name',
      'description',
      'metadata',
      'lesson_material',
      'lesson_instructions',
    ]);
    const ex = ok(
      parseExerciseManifest(exercise({ FlashcardAsset: { front_path: 'f' } })),
    );
    const encoded = encodeExerciseManifest(ex);
    expect(Object.keys(encoded)).toEqual([
      'id',
      'lesson_id',
      'course_id',
      'name',
      'description',
      'exercise_type',
      'exercise_asset',
    ]);
    expect(encoded.description).toBeNull();
  });

  it('stringifyManifest is two-space JSON with a trailing newline', () => {
    expect(stringifyManifest({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}\n');
  });

  it('encoded key order survives a reordered in-memory manifest', () => {
    const scrambled = {
      superseded: [],
      encompassed: [],
      dependencies: [],
      name: 'n',
      id: 'x',
      generator_config: null,
      course_instructions: null,
      course_material: null,
      metadata: null,
      authors: null,
      description: null,
    };
    expect(Object.keys(encodeCourseManifest(scrambled))[0]).toBe('id');
  });
});

const findFiles = (dir: string, name: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return findFiles(path, name);
    return entry.name === name ? [path] : [];
  });

const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, 'utf8'));

describe('real Trane v0.34.1 libraries', () => {
  const expected = {
    embedded: { course: 1, lesson: 1, exercise: 1, prefs: 0 },
    small: { course: 3, lesson: 0, exercise: 0, prefs: 1 },
    large: { course: 51, lesson: 0, exercise: 0, prefs: 1 },
  } as const;

  it.each(Object.entries(TRANE_LIBRARIES))(
    'every manifest of %s parses without schema errors',
    (name, dir) => {
      const counts = { course: 0, lesson: 0, exercise: 0, prefs: 0 };
      const parsers = {
        course: ['course_manifest.json', parseCourseManifest],
        lesson: ['lesson_manifest.json', parseLessonManifest],
        exercise: ['exercise_manifest.json', parseExerciseManifest],
        prefs: ['user_preferences.json', parseUserPreferences],
      } as const;
      for (const [kind, [file, parse]] of Object.entries(parsers)) {
        for (const path of findFiles(dir, file)) {
          const result = parse(readJson(path));
          expect(
            result.ok,
            `${path}: ${JSON.stringify(!result.ok && result.issues)}`,
          ).toBe(true);
          counts[kind as keyof typeof counts]++;
        }
      }
      expect(counts).toEqual(expected[name as keyof typeof expected]);
    },
  );

  it('KB lesson files of small/large parse with the KB parsers', () => {
    for (const dir of [TRANE_LIBRARIES.small, TRANE_LIBRARIES.large]) {
      for (const file of [
        'lesson.dependencies.json',
        'lesson.superseded.json',
      ]) {
        for (const path of findFiles(dir, file)) {
          expect(parseStringList(readJson(path)).ok, path).toBe(true);
        }
      }
    }
  });

  it('the large library contains parsed Transcription configs', () => {
    const generators = findFiles(TRANE_LIBRARIES.large, 'course_manifest.json')
      .map((path) => ok(parseCourseManifest(readJson(path))).generator_config)
      .filter((g) => g !== null && 'Transcription' in g);
    expect(generators).toHaveLength(48);
  });
});
