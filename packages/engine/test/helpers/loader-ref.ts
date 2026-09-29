/**
 * Эталонный синхронный загрузчик JSON-раскладки: оракул для T-34. Перенос
 * spike/loader-bench (`loader.ts`, `manual.ts`): собственный рукописный
 * валидатор и собственное разрешение путей, без кода `src/domain` и
 * `src/authoring`, кроме построителя графа (его проверяют отдельные тесты).
 * Раскладка Trane: `course_manifest.json` на любой глубине, кроме корня,
 * `lesson_manifest.json` — в прямом подкаталоге курса, `exercise_manifest.json`
 * — в прямом подкаталоге урока.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import type {
  BasicAsset,
  CourseManifest,
  ExerciseAsset,
  ExerciseManifest,
  ExerciseType,
  LessonManifest,
} from '../../src/domain/manifest.ts';
import { createUnitGraph } from '../../src/domain/graph.ts';
import type { UnitGraph } from '../../src/domain/graph.ts';

export interface RefLibrary {
  courses: Map<string, CourseManifest>;
  lessons: Map<string, LessonManifest>;
  exercises: Map<string, ExerciseManifest>;
  graph: UnitGraph;
}

type Obj = Record<string, unknown>;

const fail = (path: string, message: string): never => {
  throw new Error(`${path || '<root>'}: ${message}`);
};
const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const asObj = (v: unknown, path: string): Obj =>
  isObj(v) ? v : fail(path, 'expected object');
const str = (v: unknown, path: string): string =>
  typeof v === 'string' ? v : fail(path, 'expected string');
const strOr = (v: unknown, path: string, fallback: string): string =>
  v === undefined ? fallback : str(v, path);
const optStr = (v: unknown, path: string): string | null =>
  v === undefined || v === null ? null : str(v, path);

const strVec = (v: unknown, path: string): string[] => {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return fail(path, 'expected array');
  return v.map((item, i) => str(item, `${path}[${i}]`));
};

const encompassed = (v: unknown, path: string): Array<[string, number]> => {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return fail(path, 'expected array');
  return v.map((entry, i): [string, number] => {
    const at = `${path}[${i}]`;
    if (!Array.isArray(entry) || entry.length !== 2) {
      return fail(at, 'expected [id, weight]');
    }
    const [id, weight] = entry as [unknown, unknown];
    if (typeof weight !== 'number') return fail(at, 'expected number');
    return [str(id, at), weight];
  });
};

const metadata = (
  v: unknown,
  path: string,
): Record<string, string[]> | null => {
  if (v === undefined || v === null) return null;
  const source = asObj(v, path);
  const out: Record<string, string[]> = {};
  for (const key of Object.keys(source)) {
    out[key] = strVec(source[key], `${path}.${key}`);
  }
  return out;
};

const singleKey = (v: unknown, path: string, tags: readonly string[]) => {
  const source = asObj(v, path);
  const keys = Object.keys(source);
  const tag = keys[0];
  if (keys.length !== 1 || tag === undefined) {
    return fail(path, 'enum must have exactly one key');
  }
  if (!tags.includes(tag)) return fail(path, `unknown variant ${tag}`);
  return { tag, payload: source[tag] };
};

const basicAsset = (v: unknown, path: string): BasicAsset => {
  const { tag, payload } = singleKey(v, path, [
    'MarkdownAsset',
    'InlinedAsset',
    'InlinedUniqueAsset',
  ]);
  const at = `${path}.${tag}`;
  const body = asObj(payload, at);
  if (tag === 'MarkdownAsset') {
    return { MarkdownAsset: { path: str(body.path, `${at}.path`) } };
  }
  const content = str(body.content, `${at}.content`);
  return tag === 'InlinedAsset'
    ? { InlinedAsset: { content } }
    : { InlinedUniqueAsset: { content } };
};

const optBasic = (v: unknown, path: string): BasicAsset | null =>
  v === undefined || v === null ? null : basicAsset(v, path);

const exerciseType = (v: unknown, path: string): ExerciseType => {
  if (v === undefined) return 'Procedural';
  return v === 'Declarative' || v === 'Procedural'
    ? v
    : fail(path, 'expected Declarative|Procedural');
};

/**
 * Ассеты, которые движок не исполняет (Literacy, SoundSlice, Transcription),
 * в эталоне передаются как есть: граф от них не зависит.
 */
const exerciseAsset = (v: unknown, path: string): ExerciseAsset => {
  const { tag, payload } = singleKey(v, path, [
    'BasicAsset',
    'FlashcardAsset',
    'InlineFlashcardAsset',
    'LiteracyAsset',
    'SoundSliceAsset',
    'TranscriptionAsset',
  ]);
  const at = `${path}.${tag}`;
  if (tag === 'BasicAsset') return { BasicAsset: basicAsset(payload, at) };
  const body = asObj(payload, at);
  if (tag === 'FlashcardAsset') {
    return {
      FlashcardAsset: {
        front_path: str(body.front_path, `${at}.front_path`),
        back_path: optStr(body.back_path, `${at}.back_path`),
      },
    };
  }
  if (tag === 'InlineFlashcardAsset') {
    return {
      InlineFlashcardAsset: {
        front_content: str(body.front_content, `${at}.front_content`),
        back_content: optStr(body.back_content, `${at}.back_content`),
      },
    };
  }
  return v as ExerciseAsset;
};

const parseCourse = (raw: unknown): CourseManifest => {
  const o = asObj(raw, '');
  return {
    id: str(o.id, 'id'),
    name: strOr(o.name, 'name', ''),
    dependencies: strVec(o.dependencies, 'dependencies'),
    encompassed: encompassed(o.encompassed, 'encompassed'),
    superseded: strVec(o.superseded, 'superseded'),
    description: optStr(o.description, 'description'),
    authors:
      o.authors === undefined || o.authors === null
        ? null
        : strVec(o.authors, 'authors'),
    metadata: metadata(o.metadata, 'metadata'),
    course_material: optBasic(o.course_material, 'course_material'),
    course_instructions: optBasic(o.course_instructions, 'course_instructions'),
    // варианты генератора эталон не разбирает: такие курсы читает только сканер
    generator_config:
      o.generator_config === undefined || o.generator_config === null
        ? null
        : (o.generator_config as CourseManifest['generator_config']),
  };
};

const parseLesson = (raw: unknown): LessonManifest => {
  const o = asObj(raw, '');
  return {
    id: str(o.id, 'id'),
    dependencies: strVec(o.dependencies, 'dependencies'),
    encompassed: encompassed(o.encompassed, 'encompassed'),
    superseded: strVec(o.superseded, 'superseded'),
    course_id: str(o.course_id, 'course_id'),
    name: strOr(o.name, 'name', ''),
    description: optStr(o.description, 'description'),
    metadata: metadata(o.metadata, 'metadata'),
    lesson_material: optBasic(o.lesson_material, 'lesson_material'),
    lesson_instructions: optBasic(o.lesson_instructions, 'lesson_instructions'),
  };
};

const parseExercise = (raw: unknown): ExerciseManifest => {
  const o = asObj(raw, '');
  return {
    id: str(o.id, 'id'),
    lesson_id: str(o.lesson_id, 'lesson_id'),
    course_id: str(o.course_id, 'course_id'),
    name: strOr(o.name, 'name', ''),
    description: optStr(o.description, 'description'),
    exercise_type: exerciseType(o.exercise_type, 'exercise_type'),
    exercise_asset: exerciseAsset(o.exercise_asset, 'exercise_asset'),
  };
};

/** vfs 0.13 `join_internal`: `/` — от корня, `..` у корня зажимается, `.` и пустые пропускаются. */
const resolvePath = (dir: string, path: string): string => {
  if (path === '') return dir;
  const parts = path.startsWith('/') || dir === '' ? [] : dir.split('/');
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
};

const normalizeBasic = (asset: BasicAsset | null, dir: string) =>
  asset !== null && 'MarkdownAsset' in asset
    ? { MarkdownAsset: { path: resolvePath(dir, asset.MarkdownAsset.path) } }
    : asset;

const normalizeAsset = (asset: ExerciseAsset, dir: string): ExerciseAsset => {
  if ('BasicAsset' in asset) {
    const basic = normalizeBasic(asset.BasicAsset, dir);
    return basic === null ? asset : { BasicAsset: basic };
  }
  if ('FlashcardAsset' in asset) {
    const card = asset.FlashcardAsset;
    return {
      FlashcardAsset: {
        front_path: resolvePath(dir, card.front_path),
        back_path:
          card.back_path === null ? null : resolvePath(dir, card.back_path),
      },
    };
  }
  if ('SoundSliceAsset' in asset && asset.SoundSliceAsset.backup !== null) {
    return {
      SoundSliceAsset: {
        ...asset.SoundSliceAsset,
        backup: resolvePath(dir, asset.SoundSliceAsset.backup),
      },
    };
  }
  return asset;
};

interface ExerciseNode {
  manifest: ExerciseManifest;
}
interface LessonNode {
  manifest: LessonManifest;
  exercises: ExerciseNode[];
}
interface CourseNode {
  manifest: CourseManifest;
  lessons: LessonNode[];
}

const readJson = (root: string, path: string): unknown => {
  const text = readFileSync(`${root}/${path}`, 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${path}: ${String(error)}`, { cause: error });
  }
};

const isIgnored = (dir: string, ignored: readonly string[]) =>
  ignored.some((prefix) =>
    `${dir}/course_manifest.json`.startsWith(`${prefix.replace(/\/+$/, '')}/`),
  );

const join = (dir: string, name: string) =>
  dir === '' ? name : `${dir}/${name}`;

const isDirectory = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const walk = (
  root: string,
  dir: string,
  parentCourse: CourseNode | null,
  parentLesson: LessonNode | null,
  ignored: readonly string[],
  courses: CourseNode[],
) => {
  const abs = dir === '' ? root : `${root}/${dir}`;
  const entries = readdirSync(abs, { withFileTypes: true });
  const has = (name: string) =>
    entries.some((e) => e.name === name && !e.isDirectory());
  let course: CourseNode | null = null;
  let lesson: LessonNode | null = null;
  if (dir !== '' && has('course_manifest.json') && !isIgnored(dir, ignored)) {
    const parsed = parseCourse(
      readJson(root, join(dir, 'course_manifest.json')),
    );
    const manifest: CourseManifest = {
      ...parsed,
      course_material: normalizeBasic(parsed.course_material, dir),
      course_instructions: normalizeBasic(parsed.course_instructions, dir),
    };
    course = { manifest, lessons: [] };
    courses.push(course);
  }
  if (parentCourse !== null && has('lesson_manifest.json')) {
    const parsed = parseLesson(
      readJson(root, join(dir, 'lesson_manifest.json')),
    );
    const manifest: LessonManifest = {
      ...parsed,
      lesson_material: normalizeBasic(parsed.lesson_material, dir),
      lesson_instructions: normalizeBasic(parsed.lesson_instructions, dir),
    };
    lesson = { manifest, exercises: [] };
    parentCourse.lessons.push(lesson);
  }
  if (parentLesson !== null && has('exercise_manifest.json')) {
    const parsed = parseExercise(
      readJson(root, join(dir, 'exercise_manifest.json')),
    );
    parentLesson.exercises.push({
      manifest: {
        ...parsed,
        exercise_asset: normalizeAsset(parsed.exercise_asset, dir),
      },
    });
  }
  for (const entry of entries) {
    const childPath = join(dir, entry.name);
    if (entry.isDirectory() || isDirectory(`${root}/${childPath}`)) {
      walk(root, childPath, course, lesson, ignored, courses);
    }
  }
};

/** Сборка графа в порядке `process_results` Trane: курсы, уроки, упражнения. */
const assemble = (courses: CourseNode[]): RefLibrary => {
  const graph = createUnitGraph();
  const result: RefLibrary = {
    courses: new Map(),
    lessons: new Map(),
    exercises: new Map(),
    graph,
  };
  let encompassingEqualsDependency = true;
  for (const { manifest: cm, lessons } of courses) {
    graph.addCourse(cm.id);
    graph.addDependencies(cm.id, 'Course', cm.dependencies);
    graph.addEncompassed(cm.id, cm.dependencies, cm.encompassed);
    graph.addSuperseded(cm.id, cm.superseded);
    if (cm.encompassed.length > 0) encompassingEqualsDependency = false;
    result.courses.set(cm.id, cm);
    for (const { manifest: lm, exercises } of lessons) {
      graph.addLesson(lm.id, lm.course_id);
      graph.addDependencies(lm.id, 'Lesson', lm.dependencies);
      graph.addEncompassed(lm.id, lm.dependencies, lm.encompassed);
      graph.addSuperseded(lm.id, lm.superseded);
      if (lm.encompassed.length > 0) encompassingEqualsDependency = false;
      result.lessons.set(lm.id, lm);
      for (const { manifest: em } of exercises) {
        graph.addExercise(em.id, em.lesson_id);
        result.exercises.set(em.id, em);
      }
    }
  }
  graph.updateStartingLessons();
  if (encompassingEqualsDependency) graph.setEncompassingEqualsDependency();
  graph.checkCycles();
  return result;
};

/** Синхронная загрузка каталога JSON-раскладки; бросает на первой ошибке (fail-fast, как Trane). */
export const loadLibraryRef = (
  root: string,
  options: { ignoredPaths?: readonly string[] } = {},
): RefLibrary => {
  const ignored = (options.ignoredPaths ?? []).map((p) =>
    p.replace(/^\/+|\/+$/g, ''),
  );
  const courses: CourseNode[] = [];
  walk(root.replace(/\/+$/, ''), '', null, null, ignored, courses);
  return assemble(courses);
};
