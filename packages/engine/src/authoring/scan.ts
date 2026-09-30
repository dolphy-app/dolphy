/**
 * Сканер библиотеки: читает раскладку Trane (JSON-манифесты и KB-курсы) через
 * порт `CourseSource` в `Model` и собирает диагностики разбора вместо
 * остановки на первой ошибке. Семантические проверки графа — не здесь.
 */
import type { Diagnostic } from '@spirula/engine-contract';
import {
  InvalidAssetPathError,
  normalizeCourseManifest,
  normalizeExerciseManifest,
  normalizeLessonManifest,
  resolveAssetPath,
} from '../domain/asset-path.ts';
import type {
  BasicAsset,
  CourseManifest,
  EngineExtension,
  ExerciseManifest,
  LessonManifest,
} from '../domain/manifest.ts';
import {
  findUnknownKeys,
  parseCourseManifest,
  parseExerciseManifest,
  parseLessonManifest,
} from '../domain/manifest-schema.ts';
import type { ParseResult } from '../domain/manifest-schema.ts';
import type { CourseSource, SourceEntry } from '../ports/index.ts';
import { diag, sortDiagnostics } from './diagnostics.ts';
import { checkEngine } from './engine-schema.ts';
import type { UnitKind } from './engine-schema.ts';
import { createFileReader, MAX_TEXT_BYTES } from './file-reader.ts';
import type { FileReader, ScanStats } from './file-reader.ts';
import { readFrontEngine } from './front-engine.ts';
import { generateKnowledgeBaseCourse } from './knowledge-base.ts';
import type {
  CourseUnit,
  ExerciseUnit,
  FieldSrc,
  LessonUnit,
  Model,
  Src,
} from './model.ts';
import { topLevelKeyLines } from './source-lines.ts';

export type { ScanStats } from './file-reader.ts';

export const COURSE_MANIFEST = 'course_manifest.json';
export const LESSON_MANIFEST = 'lesson_manifest.json';
export const EXERCISE_MANIFEST = 'exercise_manifest.json';

export interface ScanOptions {
  /** Префиксы от корня библиотеки, в которых манифесты курсов не читаются. */
  ignoredPaths: readonly string[];
}

export interface ScanResult {
  /** Манифесты с нормализованными путями ассетов; `engine` — в `unit.engine`. */
  model: Model;
  diagnostics: Diagnostic[];
  stats: ScanStats;
  /** Байты файлов, прочитанных сканером (для content-revision). */
  contents: ReadonlyMap<string, Uint8Array>;
}

interface ManifestByKind {
  course: CourseManifest;
  lesson: LessonManifest;
  exercise: ExerciseManifest;
}

const PARSERS: {
  [K in UnitKind]: (raw: unknown) => ParseResult<ManifestByKind[K]>;
} = {
  course: parseCourseManifest,
  lesson: parseLessonManifest,
  exercise: parseExerciseManifest,
};

const NORMALIZERS: {
  [K in UnitKind]: (m: ManifestByKind[K], dir: string) => ManifestByKind[K];
} = {
  course: normalizeCourseManifest,
  lesson: normalizeLessonManifest,
  exercise: normalizeExerciseManifest,
};

interface Ctx {
  reader: FileReader;
  diagnostics: Diagnostic[];
  ignored: readonly string[];
}

interface ManifestRead<K extends UnitKind> {
  value: ManifestByKind[K];
  raw: Record<string, unknown>;
  keyLines: Map<string, number>;
  path: string;
  /** Строка ключа `id` (или `1`). */
  idLine: number;
}

interface EngineRead {
  engine?: EngineExtension;
  engineSrc?: Src;
  /** Ключ `engine` есть, но не прошёл проверку. */
  failed: boolean;
}

const MAX_ISSUES = 8;

const join = (dir: string, name: string) =>
  dir === '' ? name : `${dir}/${name}`;

const markdownPath = (asset: BasicAsset | null): string | null =>
  asset !== null && 'MarkdownAsset' in asset ? asset.MarkdownAsset.path : null;

const locate = (src: Src, unitId: string) => ({
  path: src.path,
  unitId,
  ...(src.line !== undefined ? { line: src.line } : {}),
});

const readManifest = async <K extends UnitKind>(
  ctx: Ctx,
  dir: string,
  kind: K,
): Promise<ManifestRead<K> | null> => {
  const path = join(dir, `${kind}_manifest.json`);
  const json = await ctx.reader.readJson(path);
  if (json === null) return null;
  const { value: raw, text } = json;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    ctx.diagnostics.push(
      diag('E_SCHEMA', 'manifest must be a JSON object', { path, line: 1 }),
    );
    return null;
  }
  const keyLines = topLevelKeyLines(text);
  const idLine = keyLines.get('id') ?? 1;
  const parsed = PARSERS[kind](raw);
  if (!parsed.ok) {
    for (const issue of parsed.issues.slice(0, MAX_ISSUES)) {
      ctx.diagnostics.push(
        diag('E_SCHEMA', `${issue.path}: ${issue.message}`, {
          path,
          line: idLine,
        }),
      );
    }
    return null;
  }
  const record = raw as Record<string, unknown>;
  const rawId = record.id;
  for (const key of findUnknownKeys(kind, raw)) {
    ctx.diagnostics.push(
      diag(
        'W_UNKNOWN_KEY',
        `unknown manifest key '${key}' (ignored by Trane)`,
        {
          path,
          line: keyLines.get(key) ?? 1,
          unitId: typeof rawId === 'string' ? rawId : '',
        },
      ),
    );
  }
  return { value: parsed.value, raw: record, keyLines, path, idLine };
};

const fieldsOf = (m: ManifestRead<UnitKind>): FieldSrc => {
  const fields: FieldSrc = {};
  for (const [key, line] of m.keyLines) fields[key] = { path: m.path, line };
  return fields;
};

const manifestEngine = (
  ctx: Ctx,
  m: ManifestRead<UnitKind>,
  kind: UnitKind,
  unitId: string,
): EngineRead => {
  if (!('engine' in m.raw)) return { failed: false };
  const engineSrc: Src = { path: m.path, line: m.keyLines.get('engine') ?? 1 };
  const engine = checkEngine(
    m.raw.engine,
    kind,
    { ...engineSrc, unitId },
    ctx.diagnostics,
  );
  return engine === null
    ? { failed: true }
    : { engine, engineSrc, failed: false };
};

/** Убирает завершающие `/` в путях ассетов (ошибка уже сообщена). */
const stripTrailingSlashes = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map(stripTrailingSlashes) as T;
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const isPath =
      key === 'path' ||
      key === 'front_path' ||
      key === 'back_path' ||
      key === 'backup';
    out[key] =
      isPath && typeof item === 'string'
        ? item.replace(/(?<=.)\/+$/, '')
        : stripTrailingSlashes(item);
  }
  return out as T;
};

const normalized = <K extends UnitKind>(
  kind: K,
  manifest: ManifestByKind[K],
  dir: string,
): ManifestByKind[K] => {
  const normalize = NORMALIZERS[kind];
  try {
    return normalize(manifest, dir);
  } catch (error) {
    if (!(error instanceof InvalidAssetPathError)) throw error;
    return normalize(stripTrailingSlashes(manifest), dir);
  }
};

/**
 * Проверяет путь ассета: выход за корень (`..`, симлинк), тип `.md`,
 * существование. Возвращает путь от корня или `null`, если ассет негоден
 * (такой файл читать нельзя).
 */
const checkAsset = async (
  ctx: Ctx,
  kind: string,
  unitId: string,
  declared: string,
  dir: string,
  at: Src,
  expectMarkdown = true,
): Promise<string | null> => {
  const where = locate(at, unitId);
  let resolved: { path: string; escapes: boolean };
  try {
    resolved = resolveAssetPath(dir, declared);
  } catch (error) {
    if (!(error instanceof InvalidAssetPathError)) throw error;
    ctx.diagnostics.push(
      diag(
        'E_ASSET_MISSING',
        `${kind} asset '${declared}' is not a valid file path (trailing '/')`,
        where,
      ),
    );
    return null;
  }
  const { path, escapes } = resolved;
  let bad = false;
  if (escapes) {
    bad = true;
    ctx.diagnostics.push(
      diag(
        'E_ASSET_ESCAPES_ROOT',
        `${kind} asset path '${declared}' climbs above the library root`,
        where,
      ),
    );
  }
  if (expectMarkdown && !/\.md$/i.test(path)) {
    bad = true;
    ctx.diagnostics.push(
      diag(
        'E_ASSET_TYPE',
        `${kind} asset '${declared}' is not a Markdown file (.md)`,
        where,
      ),
    );
  }
  const info = await ctx.reader.stat(path);
  if (info === null || info.kind !== 'file') {
    ctx.diagnostics.push(
      diag(
        'E_ASSET_MISSING',
        `${kind} asset '${declared}' does not exist (resolved to '${path}')`,
        where,
      ),
    );
    return null;
  }
  if (info.outsideRoot === true && !escapes) {
    bad = true;
    ctx.diagnostics.push(
      diag(
        'E_ASSET_ESCAPES_ROOT',
        `${kind} asset '${declared}' resolves through a symlink outside the library root`,
        where,
      ),
    );
  }
  return bad ? null : path;
};

const checkBasicAssets = async (
  ctx: Ctx,
  kind: 'course' | 'lesson',
  unitId: string,
  dir: string,
  m: ManifestRead<UnitKind>,
  unitSrc: Src,
  assets: readonly (readonly [string, BasicAsset | null])[],
) => {
  for (const [key, asset] of assets) {
    const declared = markdownPath(asset);
    if (declared === null) continue;
    const line = m.keyLines.get(key);
    const at = line === undefined ? unitSrc : { path: m.path, line };
    await checkAsset(ctx, kind, unitId, declared, dir, at);
  }
};

const scanCourse = async (
  ctx: Ctx,
  dir: string,
  entries: readonly SourceEntry[],
  into: Model,
): Promise<CourseUnit | null> => {
  const m = await readManifest(ctx, dir, 'course');
  if (m === null) return null;
  const raw = m.value;
  const src: Src = { path: m.path, line: m.idLine };
  const { engine, engineSrc } = manifestEngine(ctx, m, 'course', raw.id);
  await checkBasicAssets(ctx, 'course', raw.id, dir, m, src, [
    ['course_material', raw.course_material],
    ['course_instructions', raw.course_instructions],
  ]);
  const unit: CourseUnit = {
    manifest: normalized('course', raw, dir),
    dir,
    src,
    fields: fieldsOf(m),
    ...(engine !== undefined && engineSrc !== undefined
      ? { engine, engineSrc }
      : {}),
  };
  into.courses.push(unit);

  const generator = raw.generator_config;
  if (generator === null) return unit;
  if ('KnowledgeBase' in generator) {
    const generated = await generateKnowledgeBaseCourse(
      ctx.reader,
      { id: raw.id, dir },
      entries,
      generator.KnowledgeBase.inlined,
    );
    into.lessons.push(...generated.lessons);
    into.exercises.push(...generated.exercises);
    return unit;
  }
  const kind = Object.keys(generator)[0] ?? '';
  into.skippedCourses.push(raw.id);
  ctx.diagnostics.push(
    diag(
      'W_UNSUPPORTED_GENERATOR',
      `generator ${kind} of course ${raw.id} is not supported; its generated lessons are skipped`,
      {
        path: m.path,
        line: m.keyLines.get('generator_config') ?? 1,
        unitId: raw.id,
      },
    ),
  );
  return unit;
};

const scanLesson = async (
  ctx: Ctx,
  dir: string,
  parentCourse: CourseUnit,
  into: Model,
): Promise<LessonUnit | null> => {
  const m = await readManifest(ctx, dir, 'lesson');
  if (m === null) return null;
  const raw = m.value;
  const src: Src = { path: m.path, line: m.idLine };
  const { engine, engineSrc } = manifestEngine(ctx, m, 'lesson', raw.id);
  await checkBasicAssets(ctx, 'lesson', raw.id, dir, m, src, [
    ['lesson_material', raw.lesson_material],
    ['lesson_instructions', raw.lesson_instructions],
  ]);
  const unit: LessonUnit = {
    manifest: normalized('lesson', raw, dir),
    dir,
    parentCourseId: parentCourse.manifest.id,
    src,
    fields: fieldsOf(m),
    ...(engine !== undefined && engineSrc !== undefined
      ? { engine, engineSrc }
      : {}),
  };
  into.lessons.push(unit);
  return unit;
};

/**
 * Проверяет пути ассета упражнения; возвращает разрешённый путь front-файла
 * (его frontmatter читается), `null` — front-файла нет, `false` — front
 * негоден.
 */
const checkExerciseAsset = async (
  ctx: Ctx,
  m: ExerciseManifest,
  dir: string,
  at: Src,
): Promise<string | null | false> => {
  const asset = m.exercise_asset;
  const check = (declared: string) =>
    checkAsset(ctx, 'exercise', m.id, declared, dir, at);
  if ('BasicAsset' in asset) {
    const declared = markdownPath(asset.BasicAsset);
    return declared === null ? null : ((await check(declared)) ?? false);
  }
  if ('FlashcardAsset' in asset) {
    const front = await check(asset.FlashcardAsset.front_path);
    if (asset.FlashcardAsset.back_path !== null) {
      await check(asset.FlashcardAsset.back_path);
    }
    return front ?? false;
  }
  if ('InlineFlashcardAsset' in asset) return null;
  const kind = Object.keys(asset)[0] ?? '';
  ctx.diagnostics.push(
    diag(
      'W_ASSET_KIND_UNSUPPORTED',
      `exercise asset kind ${kind} is not supported by the engine`,
      locate({ path: at.path, line: at.line ?? 1 }, m.id),
    ),
  );
  return null;
};

const scanExercise = async (
  ctx: Ctx,
  dir: string,
  parentLesson: LessonUnit,
  into: Model,
): Promise<void> => {
  const m = await readManifest(ctx, dir, 'exercise');
  if (m === null) return;
  const raw = m.value;
  const manifestEng = manifestEngine(ctx, m, 'exercise', raw.id);
  const unit: ExerciseUnit = {
    manifest: normalized('exercise', raw, dir),
    dir,
    parentLessonId: parentLesson.manifest.id,
    parentCourseId: parentLesson.parentCourseId,
    src: { path: m.path, line: m.idLine },
    fields: fieldsOf(m),
    ...(manifestEng.engine !== undefined && manifestEng.engineSrc !== undefined
      ? { engine: manifestEng.engine, engineSrc: manifestEng.engineSrc }
      : {}),
  };
  let broken = manifestEng.failed;
  const assetSrc: Src = {
    path: m.path,
    line: m.keyLines.get('exercise_asset') ?? 1,
  };
  const frontPath = await checkExerciseAsset(ctx, raw, dir, assetSrc);
  if (frontPath === false) {
    broken = true;
  } else if (frontPath !== null) {
    const text = await ctx.reader.readText(frontPath, {
      unitId: raw.id,
      maxBytes: MAX_TEXT_BYTES,
    });
    if (text === null) {
      broken = true;
    } else {
      const front = await readFrontEngine(ctx.reader, frontPath, text, raw.id);
      broken ||= front.failed;
      if (front.engine !== undefined && front.engineSrc !== undefined) {
        if (unit.engine !== undefined) {
          broken = true;
          ctx.diagnostics.push(
            diag(
              'E_ENGINE_DUPLICATE',
              '`engine` is defined both in the manifest and in the front Markdown frontmatter',
              locate(front.engineSrc, raw.id),
            ),
          );
        } else {
          unit.engine = front.engine;
          unit.engineSrc = front.engineSrc;
        }
      }
    }
  }
  if (broken) unit.engineBroken = true;
  into.exercises.push(unit);
};

const isIgnored = (ctx: Ctx, dir: string) => {
  const manifest = `${dir}/${COURSE_MANIFEST}`;
  return ctx.ignored.some((prefix) => manifest.startsWith(`${prefix}/`));
};

const emptyModel = (): Model => ({
  courses: [],
  lessons: [],
  exercises: [],
  skippedCourses: [],
});

const mergeModel = (into: Model, from: Model) => {
  into.courses.push(...from.courses);
  into.lessons.push(...from.lessons);
  into.exercises.push(...from.exercises);
  into.skippedCourses.push(...from.skippedCourses);
};

/**
 * Каталоги-потомки обходятся параллельно (ввод-вывод ограничен читателем);
 * порядок юнитов в модели остаётся порядком обхода: каждая ветка собирает
 * свою модель, ветки склеиваются по порядку имён. `ancestors` — реальные
 * пути каталогов-симлинков на пути к каталогу (защита от петель).
 */
const walk = async (
  ctx: Ctx,
  dir: string,
  parentCourse: CourseUnit | null,
  parentLesson: LessonUnit | null,
  ancestors: ReadonlySet<string>,
): Promise<Model> => {
  const model = emptyModel();
  const entries = await ctx.reader.list(dir);
  if (entries === null) return model;
  const has = (name: string) =>
    entries.some((entry) => entry.name === name && entry.kind !== 'directory');

  let course: CourseUnit | null = null;
  let lesson: LessonUnit | null = null;
  if (dir !== '' && has(COURSE_MANIFEST) && !isIgnored(ctx, dir)) {
    course = (await scanCourse(ctx, dir, entries, model)) ?? null;
  }
  if (parentCourse !== null && has(LESSON_MANIFEST)) {
    lesson = (await scanLesson(ctx, dir, parentCourse, model)) ?? null;
  }
  if (parentLesson !== null && has(EXERCISE_MANIFEST)) {
    await scanExercise(ctx, dir, parentLesson, model);
  }

  const walkChild = async (entry: SourceEntry): Promise<Model> => {
    const child = join(dir, entry.name);
    if (entry.symlink !== true) {
      return walk(ctx, child, course, lesson, ancestors);
    }
    const info = await ctx.reader.stat(child);
    if (info === null) return emptyModel();
    if (info.outsideRoot === true) {
      ctx.diagnostics.push(
        diag(
          'E_ASSET_ESCAPES_ROOT',
          `directory symlink '${child}' points outside the library root; not followed`,
          { path: child },
        ),
      );
      return emptyModel();
    }
    const real = info.realPath;
    if (real === undefined) return walk(ctx, child, course, lesson, ancestors);
    if (ancestors.has(real)) {
      ctx.diagnostics.push(
        diag('E_IO', `symlink loop at '${child}'`, { path: child }),
      );
      return emptyModel();
    }
    return walk(ctx, child, course, lesson, new Set([...ancestors, real]));
  };

  // .git, .engine и прочие служебные каталоги не обходятся
  const children = entries.filter(
    (entry) => entry.kind === 'directory' && !entry.name.startsWith('.'),
  );
  for (const branch of await Promise.all(children.map(walkChild))) {
    mergeModel(model, branch);
  }
  return model;
};

export const scan = async (
  source: CourseSource,
  options: Partial<ScanOptions> = {},
): Promise<ScanResult> => {
  const diagnostics: Diagnostic[] = [];
  const stats: ScanStats = { files: 0, dirs: 0, bytes: 0, frontFiles: 0 };
  const reader = createFileReader(source, stats, diagnostics);
  const ctx: Ctx = {
    reader,
    diagnostics,
    ignored: (options.ignoredPaths ?? []).map((path) =>
      path.replace(/^\/+|\/+$/g, ''),
    ),
  };
  const model = await walk(ctx, '', null, null, new Set());
  // ввод-вывод параллелен: порядок диагностик фиксируем сортировкой
  return {
    model,
    diagnostics: sortDiagnostics(diagnostics),
    stats,
    contents: reader.contents,
  };
};
