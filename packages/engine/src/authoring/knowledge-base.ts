/**
 * Генератор курса KnowledgeBase (Trane `knowledge_base.rs`, spec D.3–D.4):
 * каталог `<short>.lesson/` превращается в урок и упражнения. Порядок уроков и
 * упражнений — по коду символов короткого id (в Trane он не определён).
 */
import type {
  EncompassedEntry,
  EngineExtension,
  ExerciseManifest,
  ExerciseType,
  LessonManifest,
  Metadata,
} from '../domain/manifest.ts';
import {
  parseEncompassedList,
  parseExerciseType,
  parseKbString,
  parseMetadata,
  parseStringList,
} from '../domain/manifest-schema.ts';
import type { ParseResult } from '../domain/manifest-schema.ts';
import type { SourceEntry } from '../ports/index.ts';
import { diag } from './diagnostics.ts';
import { checkEngine } from './engine-schema.ts';
import { compareCodeUnits, MAX_TEXT_BYTES } from './file-reader.ts';
import type { FileReader } from './file-reader.ts';
import { readFrontEngine } from './front-engine.ts';
import type { FrontEngine } from './front-engine.ts';
import type { ExerciseUnit, FieldSrc, LessonUnit, Src } from './model.ts';

export const LESSON_SUFFIX = '.lesson';

export type KbLessonFile =
  | 'dependencies'
  | 'superseded'
  | 'encompassed'
  | 'name'
  | 'description'
  | 'metadata'
  | 'material'
  | 'instructions'
  | 'default_exercise_type'
  | 'engine';

export type KbExercisePart = 'front' | 'back' | 'name' | 'description' | 'type';

export type KbFile =
  | { kind: 'lesson'; which: KbLessonFile }
  | { kind: 'exercise'; id: string; part: KbExercisePart };

const KB_EXACT: Record<string, KbFile> = {
  'lesson.dependencies.json': { kind: 'lesson', which: 'dependencies' },
  'lesson.superseded.json': { kind: 'lesson', which: 'superseded' },
  'lesson.encompassed.json': { kind: 'lesson', which: 'encompassed' },
  'lesson.name.json': { kind: 'lesson', which: 'name' },
  'lesson.description.json': { kind: 'lesson', which: 'description' },
  'lesson.metadata.json': { kind: 'lesson', which: 'metadata' },
  'lesson.material.md': { kind: 'lesson', which: 'material' },
  'lesson.instructions.md': { kind: 'lesson', which: 'instructions' },
  'lesson.default_exercise_type.json': {
    kind: 'lesson',
    which: 'default_exercise_type',
  },
  'lesson.engine.json': { kind: 'lesson', which: 'engine' },
};

const KB_SUFFIXES: readonly (readonly [string, KbExercisePart])[] = [
  ['.front.md', 'front'],
  ['.back.md', 'back'],
  ['.name.json', 'name'],
  ['.description.json', 'description'],
  ['.type.json', 'type'],
];

/**
 * `TryFrom<&str> for KnowledgeBaseFile`: точные имена раньше суффиксов;
 * незнакомое имя — `null`. `x.y.front.md` — упражнение `x.y`.
 */
export const parseKbFileName = (name: string): KbFile | null => {
  const exact = KB_EXACT[name];
  if (exact !== undefined) return exact;
  for (const [suffix, part] of KB_SUFFIXES) {
    if (name.endsWith(suffix)) {
      return { kind: 'exercise', id: name.slice(0, -suffix.length), part };
    }
  }
  return null;
};

/** Файлы одного упражнения по частям (записи каталога урока). */
export type KbExerciseFiles = Partial<Record<KbExercisePart, SourceEntry>>;

export interface KbExercise {
  shortId: string;
  front: SourceEntry;
  back: SourceEntry | null;
  name: string | null;
  description: string | null;
  type: ExerciseType | null;
  fields: FieldSrc;
}

export interface KbLesson {
  courseId: string;
  shortId: string;
  /** `курс::короткий id`. */
  id: string;
  /** Каталог урока от корня библиотеки. */
  dir: string;
  dependencies: string[];
  superseded: string[];
  encompassed: EncompassedEntry[];
  name: string | null;
  description: string | null;
  metadata: Metadata | null;
  defaultExerciseType: ExerciseType | null;
  hasMaterial: boolean;
  hasInstructions: boolean;
  engine?: EngineExtension;
  engineSrc?: Src;
  fields: FieldSrc;
}

export interface KbOpenedLesson {
  lesson: KbLesson;
  exercises: KbExercise[];
}

const join = (dir: string, name: string) =>
  dir === '' ? name : `${dir}/${name}`;

/**
 * Короткие id уроков курса в `dependencies`, `encompassed[*].0`, `superseded`
 * становятся `курс::id`, чужие остаются как есть; коллизия с id чужого курса
 * всегда решается в пользу своего урока (spec D.4 п.4).
 */
export const convertToFullIds = (
  courseId: string,
  lessons: readonly KbLesson[],
): KbLesson[] => {
  const shortIds = new Set(lessons.map((lesson) => lesson.shortId));
  const full = (id: string) => (shortIds.has(id) ? `${courseId}::${id}` : id);
  return lessons.map((lesson) => ({
    ...lesson,
    dependencies: lesson.dependencies.map(full),
    superseded: lesson.superseded.map(full),
    encompassed: lesson.encompassed.map(([id, weight]): EncompassedEntry => [
      full(id),
      weight,
    ]),
  }));
};

export interface KbStray {
  /** Id упражнения (`''` — файл вида `.front.md`). */
  id: string;
  reason: 'empty-id' | 'no-front';
  /** Файл группы для диагностики. */
  file: SourceEntry;
}

/**
 * Упражнение без `<id>.front.md` отбрасывается целиком; пустой id тоже.
 * Отброшенные возвращаются для `W_KB_STRAY_FILE`.
 */
export const filterMatchingExercises = (
  groups: ReadonlyMap<string, KbExerciseFiles>,
): {
  kept: Map<string, KbExerciseFiles & { front: SourceEntry }>;
  stray: KbStray[];
} => {
  const kept = new Map<string, KbExerciseFiles & { front: SourceEntry }>();
  const stray: KbStray[] = [];
  for (const [id, files] of groups) {
    const { front } = files;
    if (id === '' || front === undefined) {
      const file =
        front ?? files.back ?? files.name ?? files.description ?? files.type;
      if (file === undefined) continue;
      stray.push({ id, reason: id === '' ? 'empty-id' : 'no-front', file });
      continue;
    }
    kept.set(id, { ...files, front });
  }
  return { kept, stray };
};

const MAX_ISSUES = 8;

/** Читает JSON-файл KB; ошибки чтения, JSON и схемы — диагностиками. */
const readKbJson = async <T>(
  reader: FileReader,
  path: string,
  unitId: string,
  parse: (raw: unknown) => ParseResult<T>,
): Promise<{ value: T; text: string } | null> => {
  const json = await reader.readJson(path, { unitId });
  if (json === null) return null;
  const result = parse(json.value);
  if (result.ok) return { value: result.value, text: json.text };
  for (const issue of result.issues.slice(0, MAX_ISSUES)) {
    reader.diagnostics.push(
      diag('E_SCHEMA', `${issue.path}: ${issue.message}`, {
        path,
        line: 1,
        unitId,
      }),
    );
  }
  return null;
};

/**
 * Разбирает каталог урока: файлы урока, группы упражнений, JSON name /
 * description / type, `lesson.engine.json`. Незнакомые имена — `W_KB_STRAY_FILE`
 * (точечные файлы вроде `.DS_Store` молча пропускаются). `null`, если
 * каталог не читается (`E_IO`).
 */
export const openKbLesson = async (
  reader: FileReader,
  courseId: string,
  shortId: string,
  dir: string,
): Promise<KbOpenedLesson | null> => {
  const entries = await reader.list(dir);
  if (entries === null) return null;
  const lessonId = `${courseId}::${shortId}`;
  const { diagnostics } = reader;

  const lessonFiles: Partial<Record<KbLessonFile, string>> = {};
  const groups = new Map<string, KbExerciseFiles>();
  for (const entry of entries) {
    const file = parseKbFileName(entry.name);
    if (file === null) {
      if (entry.name.startsWith('.')) continue;
      diagnostics.push(
        diag(
          'W_KB_STRAY_FILE',
          `'${entry.name}' is not a knowledge-base file name; Trane silently ignores it`,
          { path: join(dir, entry.name), unitId: lessonId },
        ),
      );
    } else if (file.kind === 'lesson') {
      lessonFiles[file.which] = entry.name;
    } else {
      const group = groups.get(file.id) ?? {};
      group[file.part] = entry;
      groups.set(file.id, group);
    }
  }

  const { kept, stray } = filterMatchingExercises(groups);
  for (const item of stray) {
    diagnostics.push(
      diag(
        'W_KB_STRAY_FILE',
        item.reason === 'empty-id'
          ? 'exercise file with an empty id (e.g. `.front.md`) is ignored'
          : `exercise '${item.id}' has no '${item.id}.front.md'; it is dropped by Trane`,
        { path: join(dir, item.file.name), unitId: lessonId },
      ),
    );
  }

  const fields: FieldSrc = {};
  const readLesson = async <T>(
    which: KbLessonFile,
    parse: (raw: unknown) => ParseResult<T>,
  ) => {
    const name = lessonFiles[which];
    if (name === undefined) return null;
    const path = join(dir, name);
    fields[which] = { path, line: 1 };
    return (await readKbJson(reader, path, lessonId, parse))?.value ?? null;
  };

  const [
    dependencies,
    superseded,
    encompassed,
    name,
    description,
    metadata,
    defaultExerciseType,
  ] = await Promise.all([
    readLesson('dependencies', parseStringList),
    readLesson('superseded', parseStringList),
    readLesson('encompassed', parseEncompassedList),
    readLesson('name', parseKbString),
    readLesson('description', parseKbString),
    readLesson('metadata', parseMetadata),
    readLesson('default_exercise_type', parseExerciseType),
  ]);

  let engine: EngineExtension | null = null;
  let engineSrc: Src | null = null;
  if (lessonFiles.engine !== undefined) {
    const path = join(dir, lessonFiles.engine);
    const json = await reader.readJson(path, { unitId: lessonId });
    if (json !== null) {
      engineSrc = { path, line: 1 };
      fields.engine = engineSrc;
      engine = checkEngine(
        json.value,
        'lesson',
        { ...engineSrc, unitId: lessonId },
        diagnostics,
      );
    }
  }

  const exercises = await Promise.all(
    [...kept.keys()].sort(compareCodeUnits).map(async (id) => {
      const files = kept.get(id) as KbExerciseFiles & { front: SourceEntry };
      const unitId = `${lessonId}::${id}`;
      const exerciseFields: FieldSrc = {
        exercise_asset: { path: join(dir, files.front.name), line: 1 },
      };
      const readExercise = async <T>(
        part: 'name' | 'description' | 'type',
        parse: (raw: unknown) => ParseResult<T>,
      ) => {
        const entry = files[part];
        if (entry === undefined) return null;
        const path = join(dir, entry.name);
        exerciseFields[part] = { path, line: 1 };
        return (await readKbJson(reader, path, unitId, parse))?.value ?? null;
      };
      const [name, description, type] = await Promise.all([
        readExercise('name', parseKbString),
        readExercise('description', parseKbString),
        readExercise('type', parseExerciseType),
      ]);
      return {
        shortId: id,
        front: files.front,
        back: files.back ?? null,
        name: name ?? null,
        description: description ?? null,
        type: type ?? null,
        fields: exerciseFields,
      } satisfies KbExercise;
    }),
  );

  const lesson: KbLesson = {
    courseId,
    shortId,
    id: lessonId,
    dir,
    dependencies: dependencies ?? [],
    superseded: superseded ?? [],
    encompassed: encompassed ?? [],
    name,
    description,
    metadata,
    defaultExerciseType,
    hasMaterial: lessonFiles.material !== undefined,
    hasInstructions: lessonFiles.instructions !== undefined,
    fields,
    ...(engine !== null && engineSrc !== null ? { engine, engineSrc } : {}),
  };
  return { lesson, exercises };
};

/** `LessonManifest::from(KbLesson)`: пути ассетов — от корня библиотеки. */
export const toLessonManifest = (lesson: KbLesson): LessonManifest => ({
  id: lesson.id,
  dependencies: lesson.dependencies,
  encompassed: lesson.encompassed,
  superseded: lesson.superseded,
  course_id: lesson.courseId,
  name: lesson.name ?? `Lesson ${lesson.shortId}`,
  description: lesson.description,
  metadata: lesson.metadata,
  lesson_material: lesson.hasMaterial
    ? { MarkdownAsset: { path: join(lesson.dir, 'lesson.material.md') } }
    : null,
  lesson_instructions: lesson.hasInstructions
    ? { MarkdownAsset: { path: join(lesson.dir, 'lesson.instructions.md') } }
    : null,
});

/**
 * `to_exercise_manifest`: id `курс::урок::упр`; тип — файл упражнения, затем
 * `lesson.default_exercise_type.json`, затем `Procedural`. `inlined` читает
 * front и back дословно (ошибка чтения — `E_IO` читателя, содержимое пусто).
 */
export const toExerciseManifest = async (
  reader: FileReader,
  lesson: KbLesson,
  exercise: KbExercise,
  inlined: boolean,
): Promise<ExerciseManifest> => {
  const id = `${lesson.id}::${exercise.shortId}`;
  const frontPath = join(lesson.dir, exercise.front.name);
  const backPath =
    exercise.back === null ? null : join(lesson.dir, exercise.back.name);
  const readOptions = { unitId: id, maxBytes: MAX_TEXT_BYTES };
  let asset: ExerciseManifest['exercise_asset'];
  if (inlined) {
    const front = await reader.readText(frontPath, readOptions);
    const back =
      backPath === null ? null : await reader.readText(backPath, readOptions);
    asset = {
      InlineFlashcardAsset: {
        front_content: front ?? '',
        back_content: back,
      },
    };
  } else {
    asset = { FlashcardAsset: { front_path: frontPath, back_path: backPath } };
  }
  return {
    id,
    lesson_id: lesson.id,
    course_id: lesson.courseId,
    name: exercise.name ?? `Exercise ${exercise.shortId}`,
    description: exercise.description,
    exercise_type: exercise.type ?? lesson.defaultExerciseType ?? 'Procedural',
    exercise_asset: asset,
  };
};

const buildExerciseUnit = async (
  reader: FileReader,
  lesson: KbLesson,
  exercise: KbExercise,
  inlined: boolean,
): Promise<ExerciseUnit> => {
  const id = `${lesson.id}::${exercise.shortId}`;
  const frontPath = join(lesson.dir, exercise.front.name);
  if (exercise.back?.symlink === true) {
    const backPath = join(lesson.dir, exercise.back.name);
    if ((await reader.stat(backPath))?.outsideRoot === true) {
      reader.diagnostics.push(
        diag(
          'E_ASSET_ESCAPES_ROOT',
          `back file '${backPath}' resolves through a symlink outside the library root`,
          { path: backPath, unitId: id },
        ),
      );
    }
  }
  // front за корнем или нечитаем: не читается, `engine` не ждём
  const frontText = await reader.readText(frontPath, {
    unitId: id,
    maxBytes: MAX_TEXT_BYTES,
  });
  const front: FrontEngine =
    frontText === null
      ? { failed: true }
      : await readFrontEngine(reader, frontPath, frontText, id);
  const manifest = await toExerciseManifest(reader, lesson, exercise, inlined);
  return {
    manifest,
    dir: lesson.dir,
    parentLessonId: lesson.id,
    parentCourseId: lesson.courseId,
    src: { path: frontPath, line: front.engineSrc?.line ?? 1 },
    fields: exercise.fields,
    ...(front.engine !== undefined && front.engineSrc !== undefined
      ? { engine: front.engine, engineSrc: front.engineSrc }
      : {}),
    ...(front.failed ? { engineBroken: true as const } : {}),
  };
};

export interface KbCourseInput {
  id: string;
  /** Каталог курса от корня библиотеки. */
  dir: string;
}

export interface KbGenerated {
  lessons: LessonUnit[];
  exercises: ExerciseUnit[];
}

/**
 * Уроки и упражнения KB-курса. `courseEntries` — записи каталога курса.
 * Пустой короткий id (каталог `.lesson`) — `E_ID_EMPTY`, урок остаётся, как
 * в Trane (`курс::`).
 */
export const generateKnowledgeBaseCourse = async (
  reader: FileReader,
  course: KbCourseInput,
  courseEntries: readonly SourceEntry[],
  inlined: boolean,
): Promise<KbGenerated> => {
  const lessonDirs = courseEntries
    .filter(
      (entry) =>
        entry.kind === 'directory' && entry.name.endsWith(LESSON_SUFFIX),
    )
    .map((entry) => ({
      entry,
      shortId: entry.name.slice(0, -LESSON_SUFFIX.length),
    }))
    .sort((a, b) => compareCodeUnits(a.shortId, b.shortId));

  const results = await Promise.all(
    lessonDirs.map(async ({ entry, shortId }) => {
      const dir = join(course.dir, entry.name);
      // каталог-симлинк наружу не обходится (E_ASSET_ESCAPES_ROOT — от обхода)
      if (
        entry.symlink === true &&
        (await reader.stat(dir))?.outsideRoot === true
      ) {
        return null;
      }
      return openKbLesson(reader, course.id, shortId, dir);
    }),
  );
  const opened = results.filter(
    (lesson): lesson is KbOpenedLesson => lesson !== null,
  );

  const converted = convertToFullIds(
    course.id,
    opened.map(({ lesson }) => lesson),
  );
  const lessons: LessonUnit[] = [];
  const pending: Promise<ExerciseUnit>[] = [];
  for (const [index, lesson] of converted.entries()) {
    const { exercises: kbExercises } = opened[index] as KbOpenedLesson;
    if (lesson.shortId === '') {
      reader.diagnostics.push(
        diag(
          'E_ID_EMPTY',
          "empty short lesson id (directory named '.lesson')",
          { path: lesson.dir, unitId: lesson.id },
        ),
      );
    }
    lessons.push({
      manifest: toLessonManifest(lesson),
      dir: lesson.dir,
      parentCourseId: course.id,
      src: { path: lesson.dir, line: 1 },
      fields: lesson.fields,
      ...(lesson.engine !== undefined && lesson.engineSrc !== undefined
        ? { engine: lesson.engine, engineSrc: lesson.engineSrc }
        : {}),
    });
    for (const exercise of kbExercises) {
      pending.push(buildExerciseUnit(reader, lesson, exercise, inlined));
    }
  }
  return { lessons, exercises: await Promise.all(pending) };
};
