/**
 * Манифест → DTO контракта (engine-ts-api.md §3). Правила: `metadata` —
 * пустая запись вместо `null`; `description` и другие необязательные поля
 * при отсутствии значения опускаются (exactOptionalPropertyTypes); ссылка
 * `AssetRef` есть только у файловых ассетов (`MarkdownAsset`), у встроенных
 * (`InlinedAsset`) её нет.
 */
import type {
  AssetRef,
  CourseDto,
  ExerciseContentDto,
  ExerciseDto,
  ExerciseTaskDto,
  GraphDto,
  GraphEdgeDto,
  GraphNodeDto,
  GraphQuery,
  LessonDto,
  UnitDto,
  UnitId,
  UnitKind,
  UnitCommon,
  WeightedRef,
} from '@lms/engine-contract';
import type { ExerciseTypes } from '../ports/exercise-types.ts';
import type { ExtensionPolicy } from '../ports/extension-policy.ts';
import type { UnitType } from '../domain/graph.ts';
import type { Library } from '../domain/library.ts';
import type {
  BasicAsset,
  CourseManifest,
  ExerciseAsset,
  ExerciseManifest,
  LessonManifest,
  Metadata,
} from '../domain/manifest.ts';
import { EngineError } from './errors.ts';

/** Таймаут проверки, если в `engine.exercise` нет `timeoutMs`. */
export const DEFAULT_EXERCISE_TIMEOUT_MS = 2000;
export const DEFAULT_GRAPH_LIMIT = 500;
export const MAX_GRAPH_LIMIT = 2000;

const compare = (a: string, b: string) => Number(a > b) - Number(a < b);

const toMetadata = (metadata: Metadata | null): Record<string, string[]> => {
  const copy: Record<string, string[]> = {};
  if (metadata === null) return copy;
  for (const [key, values] of Object.entries(metadata)) copy[key] = [...values];
  return copy;
};

const toAssetRef = (
  unitId: UnitId,
  asset: BasicAsset | null,
): AssetRef | undefined =>
  asset !== null && 'MarkdownAsset' in asset
    ? { unitId, path: asset.MarkdownAsset.path }
    : undefined;

const toWeightedRefs = (
  entries: readonly (readonly [string, number])[],
): WeightedRef[] => entries.map(([id, weight]) => ({ id, weight }));

const toCommon = (manifest: CourseManifest | LessonManifest): UnitCommon => ({
  id: manifest.id,
  name: manifest.name,
  ...(manifest.description === null
    ? {}
    : { description: manifest.description }),
  metadata: toMetadata(manifest.metadata),
  dependencies: [...manifest.dependencies],
  encompassed: toWeightedRefs(manifest.encompassed),
  superseded: [...manifest.superseded],
});

export const toCourseDto = (
  course: CourseManifest,
  lessonCount: number,
): CourseDto => {
  const material = toAssetRef(course.id, course.course_material);
  const instructions = toAssetRef(course.id, course.course_instructions);
  return {
    kind: 'course',
    ...toCommon(course),
    lessonCount,
    ...(course.authors === null ? {} : { authors: [...course.authors] }),
    ...(material === undefined ? {} : { material }),
    ...(instructions === undefined ? {} : { instructions }),
  };
};

export const toLessonDto = (
  lesson: LessonManifest,
  exerciseCount: number,
): LessonDto => {
  const material = toAssetRef(lesson.id, lesson.lesson_material);
  const instructions = toAssetRef(lesson.id, lesson.lesson_instructions);
  return {
    kind: 'lesson',
    ...toCommon(lesson),
    courseId: lesson.course_id,
    exerciseCount,
    ...(material === undefined ? {} : { material }),
    ...(instructions === undefined ? {} : { instructions }),
  };
};

/**
 * Literacy, SoundSlice и Transcription движок не исполняет (engine-ts.md §3):
 * упражнение остаётся видимым, вместо содержимого — пояснение.
 */
const unsupportedContent = (assetKind: string): ExerciseContentDto => ({
  type: 'inlineMarkdown',
  text: `This exercise uses ${assetKind}, which the engine does not support.`,
});

const toBasicContent = (
  exerciseId: UnitId,
  asset: BasicAsset,
): ExerciseContentDto => {
  if ('MarkdownAsset' in asset) {
    return {
      type: 'markdown',
      ref: { unitId: exerciseId, path: asset.MarkdownAsset.path },
    };
  }
  const { content } =
    'InlinedAsset' in asset ? asset.InlinedAsset : asset.InlinedUniqueAsset;
  return { type: 'inlineMarkdown', text: content };
};

const toContent = (
  exerciseId: UnitId,
  asset: ExerciseAsset,
): ExerciseContentDto => {
  if ('BasicAsset' in asset)
    return toBasicContent(exerciseId, asset.BasicAsset);
  if ('FlashcardAsset' in asset) {
    const { front_path: front, back_path: back } = asset.FlashcardAsset;
    return {
      type: 'flashcard',
      front: { unitId: exerciseId, path: front },
      ...(back === null ? {} : { back: { unitId: exerciseId, path: back } }),
    };
  }
  if ('InlineFlashcardAsset' in asset) {
    const { front_content: front, back_content: back } =
      asset.InlineFlashcardAsset;
    return {
      type: 'inlineFlashcard',
      front,
      ...(back === null ? {} : { back }),
    };
  }
  if ('LiteracyAsset' in asset) return unsupportedContent('LiteracyAsset');
  if ('SoundSliceAsset' in asset) return unsupportedContent('SoundSliceAsset');
  return unsupportedContent('TranscriptionAsset');
};

const toTaskField = (
  exercise: ExerciseManifest,
  types: ExerciseTypes,
  policy: ExtensionPolicy,
): { task?: ExerciseTaskDto } => {
  const block = exercise.engine?.exercise;
  if (block === undefined) return {};
  const info = types.describe(block.type);
  if (info === undefined) return {};
  return {
    task: {
      type: block.type,
      timeoutMs: block.timeoutMs ?? DEFAULT_EXERCISE_TIMEOUT_MS,
      element: info.element,
      rendererUrl: info.rendererUrl,
      isolated: policy.isIsolated(info.extensionId),
    },
  };
};

export const toExerciseDto = (
  exercise: ExerciseManifest,
  types: ExerciseTypes,
  policy: ExtensionPolicy,
): ExerciseDto => ({
  kind: 'exercise',
  id: exercise.id,
  lessonId: exercise.lesson_id,
  courseId: exercise.course_id,
  name: exercise.name,
  ...(exercise.description === null
    ? {}
    : { description: exercise.description }),
  exerciseType:
    exercise.exercise_type === 'Declarative' ? 'declarative' : 'procedural',
  content: toContent(exercise.id, exercise.exercise_asset),
  ...toTaskField(exercise, types, policy),
  keyPrerequisites: [...(exercise.engine?.keyPrerequisites ?? [])],
});

const notFound = (id: UnitId) =>
  new EngineError('NOT_FOUND', { details: { unitId: id } });

export const toUnitDto = (
  library: Library,
  id: UnitId,
  types: ExerciseTypes,
  policy: ExtensionPolicy,
): UnitDto => {
  const course = library.getCourse(id);
  if (course !== undefined) {
    return toCourseDto(course, library.getLessonIds(id)?.length ?? 0);
  }
  const lesson = library.getLesson(id);
  if (lesson !== undefined) {
    return toLessonDto(lesson, library.getExerciseIds(id)?.length ?? 0);
  }
  const exercise = library.getExercise(id);
  if (exercise !== undefined) return toExerciseDto(exercise, types, policy);
  throw notFound(id);
};

/* --------------------------------- граф ---------------------------------- */

const KIND_OF: Record<UnitType, UnitKind> = {
  Course: 'course',
  Lesson: 'lesson',
  Exercise: 'exercise',
};
const UNIT_KINDS: readonly UnitKind[] = ['course', 'lesson', 'exercise'];

const invalidQuery = (field: string, message: string) =>
  new EngineError('INVALID_ARGUMENT', { message, details: { field } });

const validateGraphQuery = (query: GraphQuery) => {
  const { limit, depth, kinds } = query;
  if (
    limit !== undefined &&
    !(Number.isInteger(limit) && limit >= 1 && limit <= MAX_GRAPH_LIMIT)
  ) {
    throw invalidQuery(
      'limit',
      `Graph limit must be an integer in 1..${MAX_GRAPH_LIMIT}`,
    );
  }
  if (depth !== undefined && !(Number.isInteger(depth) && depth >= 0)) {
    throw invalidQuery('depth', 'Graph depth must be a non-negative integer');
  }
  for (const kind of kinds ?? []) {
    if (!UNIT_KINDS.includes(kind)) {
      throw invalidQuery('kinds', `Unknown unit kind: ${String(kind)}`);
    }
  }
};

const kindOf = (library: Library, id: UnitId): UnitKind => {
  const type = library.graph.getUnitType(id);
  if (type === undefined) throw notFound(id);
  return KIND_OF[type];
};

const nameOf = (library: Library, id: UnitId): string =>
  (library.getCourse(id) ?? library.getLesson(id) ?? library.getExercise(id))
    ?.name ?? id;

/** Соседи по рёбрам графа и по вложенности, в обе стороны. */
const neighborsOf = (library: Library, id: UnitId): string[] => {
  const { graph } = library;
  const near = new Set<string>();
  const parent = graph.getParent(id);
  if (parent !== undefined) near.add(parent);
  for (const sets of [
    graph.getCourseLessons(id),
    graph.getLessonExercises(id),
    graph.getDependencies(id),
    graph.getDependents(id),
    graph.getSupersedes(id),
    graph.getSupersededBy(id),
  ]) {
    for (const other of sets ?? []) near.add(other);
  }
  for (const [other] of graph.getEncompasses(id) ?? []) near.add(other);
  for (const [other] of graph.getEncompassedBy(id) ?? []) near.add(other);
  return [...near];
};

/** Окрестность корней по рёбрам и вложенности; без `depth` — вся компонента. */
const collectNeighborhood = (
  library: Library,
  rootIds: readonly UnitId[],
  depth: number | undefined,
): Set<UnitId> => {
  const seen = new Set<UnitId>();
  let frontier: UnitId[] = [];
  for (const id of rootIds) {
    kindOf(library, id);
    if (!seen.has(id)) {
      seen.add(id);
      frontier.push(id);
    }
  }
  for (let level = 0; frontier.length > 0; level++) {
    if (depth !== undefined && level >= depth) break;
    const next: UnitId[] = [];
    for (const id of frontier) {
      for (const other of neighborsOf(library, id)) {
        if (seen.has(other)) continue;
        seen.add(other);
        next.push(other);
      }
    }
    frontier = next;
  }
  return seen;
};

const manifestEdges = (
  library: Library,
  id: UnitId,
  included: ReadonlySet<UnitId>,
): GraphEdgeDto[] => {
  const manifest = library.getCourse(id) ?? library.getLesson(id);
  if (manifest === undefined) return [];
  const edges: GraphEdgeDto[] = [];
  for (const to of manifest.dependencies) {
    if (included.has(to)) edges.push({ from: id, to, type: 'dependency' });
  }
  for (const [to, weight] of manifest.encompassed) {
    if (included.has(to)) {
      edges.push({ from: id, to, type: 'encompassed', weight });
    }
  }
  for (const to of manifest.superseded) {
    if (included.has(to)) edges.push({ from: id, to, type: 'superseded' });
  }
  return edges;
};

/**
 * Граф для визуализации. Без `rootIds` — все юниты; иначе окрестность корней
 * (`depth` шагов по рёбрам и вложенности, без `depth` — вся связная часть).
 * Узлы отсортированы по коду символов id; `limit` (по умолчанию 500, максимум
 * 2000) обрезает список, рёбра — только между оставшимися узлами.
 */
export const toGraphDto = (
  library: Library,
  query: GraphQuery = {},
): GraphDto => {
  validateGraphQuery(query);
  const { rootIds, depth, kinds, limit = DEFAULT_GRAPH_LIMIT } = query;
  const scope =
    rootIds === undefined || rootIds.length === 0
      ? [...library.graph.unitIds()]
      : [...collectNeighborhood(library, rootIds, depth)];
  const allowedKinds = kinds === undefined ? null : new Set(kinds);
  const candidates = scope
    .filter(
      (id) => allowedKinds === null || allowedKinds.has(kindOf(library, id)),
    )
    .sort(compare);
  const truncated = candidates.length > limit;
  const included = new Set(candidates.slice(0, limit));

  const nodes: GraphNodeDto[] = [];
  const edges: GraphEdgeDto[] = [];
  for (const id of included) {
    const parentId = library.graph.getParent(id);
    nodes.push({
      id,
      kind: kindOf(library, id),
      name: nameOf(library, id),
      ...(parentId === undefined ? {} : { parentId }),
    });
    edges.push(...manifestEdges(library, id, included));
  }
  edges.sort(
    (a, b) =>
      compare(a.from, b.from) || compare(a.to, b.to) || compare(a.type, b.type),
  );
  return { nodes, edges, truncated };
};
