/**
 * Схемы zod 4 для манифестов Trane v0.34.1 (serde-совместимый wire-формат,
 * spec A.3) и кодек записи.
 *
 * Правила serde, которые воспроизводит модуль:
 * - неизвестные ключи структур молча отбрасываются;
 * - внешне тегированный enum — объект ровно с одним ключом-именем варианта,
 *   unit-вариант — строка; регистр важен;
 * - `#[serde(default)]` — ключ можно опустить, но `null` для не-`Option`
 *   поля — ошибка; `Option` принимает отсутствие и `null` (→ `null`);
 * - кортеж `(A, B)` — массив ровно из двух элементов.
 *
 * Ключ `engine` схемой манифеста не разбирается — его читает компилятор.
 */
import { z } from 'zod';
import type {
  BasicAsset,
  CourseGenerator,
  CourseManifest,
  EncompassedEntry,
  ExerciseAsset,
  ExerciseManifest,
  ExerciseType,
  LessonManifest,
  Metadata,
  TranscriptionAssetDefinition,
  TranscriptionLink,
  UserPreferences,
} from './manifest.ts';

export interface SchemaIssue {
  /** Например `exercise_asset.FlashcardAsset.front_path` или `(root)`. */
  path: string;
  message: string;
}

export type ParseResult<T> =
  { ok: true; value: T } | { ok: false; issues: SchemaIssue[] };

type Ctx = z.core.$RefinementCtx<unknown>;

const formatPath = (path: readonly PropertyKey[]): string => {
  if (path.length === 0) return '(root)';
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else out += out === '' ? String(part) : `.${String(part)}`;
  }
  return out;
};

const describe = (value: unknown): string => {
  if (value === undefined) return 'missing value';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const quoted = (names: readonly string[]): string =>
  names.map((name) => `\`${name}\``).join(', ');

const fail = (
  ctx: Ctx,
  input: unknown,
  message: string,
  path: readonly PropertyKey[] = [],
) => {
  ctx.issues.push({ code: 'custom', message, input, path: [...path] });
  return z.NEVER;
};

/**
 * Внешне тегированный enum с непустым payload. Собственный помощник вместо
 * `z.union`: выдаёт читаемые сообщения и путь до поля внутри варианта, а не
 * `invalid_union`.
 */
const tagged = <T>(variants: Record<string, z.ZodType>): z.ZodType<T> => {
  const names = Object.keys(variants);
  return z.unknown().transform((raw, ctx): T => {
    if (!isPlainObject(raw)) {
      return fail(
        ctx,
        raw,
        `enum wrapper must be an object with exactly one key, got ${describe(raw)}; expected one of ${quoted(names)}`,
      );
    }
    const keys = Object.keys(raw);
    const [key] = keys;
    if (keys.length !== 1 || key === undefined) {
      return fail(
        ctx,
        raw,
        `enum wrapper must have exactly one key, found ${keys.length}${
          keys.length > 0 ? ` (${quoted(keys)})` : ''
        }`,
      );
    }
    const schema = variants[key];
    if (schema === undefined) {
      return fail(
        ctx,
        raw,
        `unknown variant \`${key}\`, expected one of ${quoted(names)}`,
      );
    }
    const result = schema.safeParse(raw[key]);
    if (result.success) return { [key]: result.data } as T;
    for (const issue of result.error.issues) {
      fail(ctx, raw, issue.message, [key, ...issue.path]);
    }
    return z.NEVER;
  });
};

/** Unit-варианты enum: строка из списка, регистр важен. */
const unitEnum = <T extends string>(names: readonly T[]): z.ZodType<T> =>
  z.unknown().transform((raw, ctx): T => {
    if (typeof raw !== 'string') {
      return fail(
        ctx,
        raw,
        `expected a string, one of ${quoted(names)}, got ${describe(raw)}`,
      );
    }
    const found = names.find((name) => name === raw);
    if (found === undefined) {
      return fail(
        ctx,
        raw,
        `unknown variant \`${raw}\`, expected one of ${quoted(names)}`,
      );
    }
    return found;
  });

const str = z.string();
const optStr = z.string().nullable().default(null);
const strVec = z.array(z.string()).default(() => []);
const encompassedEntry = z.tuple([z.string(), z.number()]);
const encompassedList = z.array(encompassedEntry);
const metadata = z.record(z.string(), z.array(z.string()));
const exerciseType = unitEnum<ExerciseType>(['Declarative', 'Procedural']);
const exerciseTypeDefault = exerciseType.default('Procedural');
const example = z.tuple([z.string(), z.string().nullable()]);

const basicAsset = tagged<BasicAsset>({
  MarkdownAsset: z.object({ path: str }),
  InlinedAsset: z.object({ content: str }),
  InlinedUniqueAsset: z.object({ content: str }),
});

const transcriptionLink = tagged<TranscriptionLink>({ YouTube: str });
const optLink = transcriptionLink.nullable().default(null);

const exerciseAsset = tagged<ExerciseAsset>({
  BasicAsset: basicAsset,
  FlashcardAsset: z.object({ front_path: str, back_path: optStr }),
  InlineFlashcardAsset: z.object({ front_content: str, back_content: optStr }),
  LiteracyAsset: z.object({
    lesson_type: unitEnum(['Reading', 'Dictation']),
    examples: z.array(example).default(() => []),
    exceptions: z.array(example).default(() => []),
  }),
  SoundSliceAsset: z.object({
    link: str,
    description: optStr,
    backup: optStr,
  }),
  TranscriptionAsset: z.object({
    content: z.string().default(''),
    external_link: optLink,
  }),
});

const transcriptionPassages = z.object({
  asset: tagged<TranscriptionAssetDefinition>({
    Track: z.object({
      short_id: str,
      track_name: str,
      artist_name: optStr,
      album_name: optStr,
      duration: optStr,
      external_link: optLink,
    }),
  }),
  intervals: z
    .record(z.string().regex(/^\d+$/), z.tuple([z.string(), z.string()]))
    .default(() => ({})),
});

const courseGenerator = tagged<CourseGenerator>({
  KnowledgeBase: z.object({ inlined: z.boolean().default(false) }),
  Literacy: z.object({
    generate_dictation: z.boolean().default(false),
    exercise_type: exerciseTypeDefault,
  }),
  Transcription: z.object({
    transcription_dependencies: strVec,
    passage_directory: z.string().default(''),
    inlined_passages: z.array(transcriptionPassages).default(() => []),
    skip_singing_lessons: z.boolean().default(false),
    skip_advanced_lessons: z.boolean().default(false),
  }),
});

const courseSchema = z.object({
  id: str,
  name: z.string().default(''),
  dependencies: strVec,
  encompassed: encompassedList.default(() => []),
  superseded: strVec,
  description: optStr,
  authors: z.array(z.string()).nullable().default(null),
  metadata: metadata.nullable().default(null),
  course_material: basicAsset.nullable().default(null),
  course_instructions: basicAsset.nullable().default(null),
  generator_config: courseGenerator.nullable().default(null),
});

const lessonSchema = z.object({
  id: str,
  dependencies: strVec,
  encompassed: encompassedList.default(() => []),
  superseded: strVec,
  course_id: str,
  name: z.string().default(''),
  description: optStr,
  metadata: metadata.nullable().default(null),
  lesson_material: basicAsset.nullable().default(null),
  lesson_instructions: basicAsset.nullable().default(null),
});

const exerciseSchema = z.object({
  id: str,
  lesson_id: str,
  course_id: str,
  name: z.string().default(''),
  description: optStr,
  exercise_type: exerciseTypeDefault,
  exercise_asset: exerciseAsset,
});

const preferencesSchema = z.object({
  transcription: z
    .object({
      instruments: z.array(z.object({ name: str, id: str })).default(() => []),
      download_path: optStr,
      download_path_alias: optStr,
    })
    .nullable()
    .default(null),
  scheduler: z
    .object({
      batch_size: z.number().int().nonnegative().nullable().default(null),
    })
    .nullable()
    .default(null),
  ignored_paths: strVec,
});

const toResult = <T>(schema: z.ZodType, raw: unknown): ParseResult<T> => {
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data as T };
  const issues = result.error.issues.map(({ path, message }) => ({
    path: formatPath(path),
    message,
  }));
  return { ok: false, issues };
};

const parser =
  <T>(schema: z.ZodType) =>
  (raw: unknown): ParseResult<T> =>
    toResult<T>(schema, raw);

export const parseCourseManifest = parser<CourseManifest>(courseSchema);
export const parseLessonManifest = parser<LessonManifest>(lessonSchema);
export const parseExerciseManifest = parser<ExerciseManifest>(exerciseSchema);
export const parseUserPreferences = parser<UserPreferences>(preferencesSchema);

// Файлы KnowledgeBase-урока: каждый — самостоятельный JSON.
export const parseStringList = parser<string[]>(z.array(z.string()));
export const parseEncompassedList = parser<EncompassedEntry[]>(encompassedList);
export const parseMetadata = parser<Metadata>(metadata);
export const parseKbString = parser<string>(z.string());
export const parseExerciseType = parser<ExerciseType>(exerciseType);

const ENGINE_KEY = 'engine';

/** Известные ключи манифестов (порядок serde), включая `engine`. */
export const MANIFEST_KEYS: Record<
  'course' | 'lesson' | 'exercise',
  readonly string[]
> = {
  course: [...Object.keys(courseSchema.shape), ENGINE_KEY],
  lesson: [...Object.keys(lessonSchema.shape), ENGINE_KEY],
  exercise: [...Object.keys(exerciseSchema.shape), ENGINE_KEY],
};

/** Ключи верхнего уровня, которых нет в схеме манифеста (для W_UNKNOWN_KEY). */
export const findUnknownKeys = (
  kind: 'course' | 'lesson' | 'exercise',
  raw: object,
): string[] => {
  const known = new Set(MANIFEST_KEYS[kind]);
  return Object.keys(raw).filter((key) => !known.has(key));
};

// ---------------------------------------------------------------- кодек

type Encoded = Record<string, unknown>;

const encodeBasicAsset = (asset: BasicAsset | null): Encoded | null => {
  if (asset === null) return null;
  if ('MarkdownAsset' in asset) {
    return { MarkdownAsset: { path: asset.MarkdownAsset.path } };
  }
  if ('InlinedAsset' in asset) {
    return { InlinedAsset: { content: asset.InlinedAsset.content } };
  }
  return {
    InlinedUniqueAsset: { content: asset.InlinedUniqueAsset.content },
  };
};

const encodeLink = (link: TranscriptionLink | null): Encoded | null =>
  link === null ? null : { YouTube: link.YouTube };

const encodeExerciseAsset = (asset: ExerciseAsset): Encoded => {
  if ('BasicAsset' in asset) {
    return { BasicAsset: encodeBasicAsset(asset.BasicAsset) };
  }
  if ('FlashcardAsset' in asset) {
    const flashcard = asset.FlashcardAsset;
    return {
      FlashcardAsset: {
        front_path: flashcard.front_path,
        back_path: flashcard.back_path,
      },
    };
  }
  if ('InlineFlashcardAsset' in asset) {
    const flashcard = asset.InlineFlashcardAsset;
    return {
      InlineFlashcardAsset: {
        front_content: flashcard.front_content,
        back_content: flashcard.back_content,
      },
    };
  }
  if ('LiteracyAsset' in asset) {
    const literacy = asset.LiteracyAsset;
    return {
      LiteracyAsset: {
        lesson_type: literacy.lesson_type,
        examples: literacy.examples,
        exceptions: literacy.exceptions,
      },
    };
  }
  if ('SoundSliceAsset' in asset) {
    const { link, description, backup } = asset.SoundSliceAsset;
    return { SoundSliceAsset: { link, description, backup } };
  }
  const transcription = asset.TranscriptionAsset;
  return {
    TranscriptionAsset: {
      content: transcription.content,
      external_link: encodeLink(transcription.external_link),
    },
  };
};

const encodeGenerator = (generator: CourseGenerator | null): Encoded | null => {
  if (generator === null) return null;
  if ('KnowledgeBase' in generator) {
    return { KnowledgeBase: { inlined: generator.KnowledgeBase.inlined } };
  }
  if ('Literacy' in generator) {
    const literacy = generator.Literacy;
    return {
      Literacy: {
        generate_dictation: literacy.generate_dictation,
        exercise_type: literacy.exercise_type,
      },
    };
  }
  const config = generator.Transcription;
  return {
    Transcription: {
      transcription_dependencies: config.transcription_dependencies,
      passage_directory: config.passage_directory,
      inlined_passages: config.inlined_passages.map(({ asset, intervals }) => {
        const { Track: track } = asset;
        return {
          asset: {
            Track: {
              short_id: track.short_id,
              track_name: track.track_name,
              artist_name: track.artist_name,
              album_name: track.album_name,
              duration: track.duration,
              external_link: encodeLink(track.external_link),
            },
          },
          intervals,
        };
      }),
      skip_singing_lessons: config.skip_singing_lessons,
      skip_advanced_lessons: config.skip_advanced_lessons,
    },
  };
};

const withEngine = (
  encoded: Encoded,
  engine: CourseManifest['engine'],
): Encoded => (engine === undefined ? encoded : { ...encoded, engine });

export const encodeCourseManifest = (m: CourseManifest): Encoded =>
  withEngine(
    {
      id: m.id,
      name: m.name,
      dependencies: m.dependencies,
      encompassed: m.encompassed,
      superseded: m.superseded,
      description: m.description,
      authors: m.authors,
      metadata: m.metadata,
      course_material: encodeBasicAsset(m.course_material),
      course_instructions: encodeBasicAsset(m.course_instructions),
      generator_config: encodeGenerator(m.generator_config),
    },
    m.engine,
  );

export const encodeLessonManifest = (m: LessonManifest): Encoded =>
  withEngine(
    {
      id: m.id,
      dependencies: m.dependencies,
      encompassed: m.encompassed,
      superseded: m.superseded,
      course_id: m.course_id,
      name: m.name,
      description: m.description,
      metadata: m.metadata,
      lesson_material: encodeBasicAsset(m.lesson_material),
      lesson_instructions: encodeBasicAsset(m.lesson_instructions),
    },
    m.engine,
  );

export const encodeExerciseManifest = (m: ExerciseManifest): Encoded =>
  withEngine(
    {
      id: m.id,
      lesson_id: m.lesson_id,
      course_id: m.course_id,
      name: m.name,
      description: m.description,
      exercise_type: m.exercise_type,
      exercise_asset: encodeExerciseAsset(m.exercise_asset),
    },
    m.engine,
  );

export const encodeUserPreferences = (m: UserPreferences): Encoded => {
  const { transcription = null } = m;
  return {
    transcription:
      transcription === null
        ? null
        : {
            instruments: transcription.instruments.map(({ name, id }) => ({
              name,
              id,
            })),
            download_path: transcription.download_path,
            download_path_alias: transcription.download_path_alias,
          },
    scheduler:
      m.scheduler === null ? null : { batch_size: m.scheduler.batch_size },
    ignored_paths: m.ignored_paths,
  };
};

export const stringifyManifest = (encoded: unknown): string =>
  `${JSON.stringify(encoded, null, 2)}\n`;
