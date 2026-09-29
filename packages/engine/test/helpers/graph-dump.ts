/**
 * Дамп графа в формате Rust-дампера (`dump-rs`, 15 секций) и сравнение с
 * эталоном. Множества — отсортированы, веса — как f32 (`Math.fround`).
 */
import type { Library } from '../../src/domain/library.ts';

export type Dump = Record<string, unknown>;

export const SECTIONS = [
  'units',
  'missing_units',
  'dependencies',
  'dependents',
  'encompasses',
  'encompassed_by',
  'supersedes',
  'superseded_by',
  'lesson_course',
  'lesson_exercises',
  'course_lessons',
  'starting_lessons',
  'dependency_sinks',
  'encompassing_equals_dependency',
  'assets',
] as const;

/** Секции отношений между юнитами: для сверки скелета курсов. */
export const RELATION_SECTIONS = [
  'dependencies',
  'dependents',
  'encompasses',
  'encompassed_by',
  'supersedes',
  'superseded_by',
] as const;

const compare = (a: string, b: string) => {
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

const sortedIds = (ids: Iterable<string> | undefined) => {
  const sorted = ids === undefined ? [] : [...ids].sort(compare);
  return sorted.length > 0 ? sorted : undefined;
};

const sortedWeighted = (
  pairs: readonly (readonly [string, number])[] | undefined,
) => {
  const weighted = (pairs ?? [])
    .map(([id, weight]) => [id, Math.fround(weight)] as const)
    .sort((a, b) => compare(a[0], b[0]) || a[1] - b[1]);
  return weighted.length > 0 ? weighted : undefined;
};

export const dumpLibrary = (library: Library): Dump => {
  const { graph } = library;
  const units: Record<string, string> = {};
  for (const id of library.courses.keys()) units[id] = 'Course';
  for (const id of library.lessons.keys()) units[id] = 'Lesson';
  for (const id of library.exercises.keys()) units[id] = 'Exercise';

  const referenced = new Set<string>();
  for (const id of [...library.courses.keys(), ...library.lessons.keys()]) {
    for (const x of graph.getDependencies(id) ?? []) referenced.add(x);
    for (const x of graph.getSupersedes(id) ?? []) referenced.add(x);
    for (const [x] of graph.getEncompasses(id) ?? []) referenced.add(x);
  }
  const missing = [...referenced]
    .filter(
      (id) => units[id] === undefined && graph.getUnitType(id) === undefined,
    )
    .sort(compare);
  const all = [...Object.keys(units), ...missing];

  const section = (read: (id: string) => unknown) => {
    const result: Record<string, unknown> = {};
    for (const id of all) {
      const value = read(id);
      if (value !== undefined) result[id] = value;
    }
    return result;
  };

  const lessonCourse: Record<string, unknown> = {};
  const lessonExercises: Record<string, unknown> = {};
  for (const id of library.lessons.keys()) {
    lessonCourse[id] = graph.getLessonCourse(id) ?? null;
    const exercises = sortedIds(graph.getLessonExercises(id));
    if (exercises) lessonExercises[id] = exercises;
  }
  const courseLessons: Record<string, unknown> = {};
  const startingLessons: Record<string, unknown> = {};
  for (const id of library.courses.keys()) {
    const lessons = graph.getCourseLessons(id);
    if (lessons) courseLessons[id] = sortedIds(lessons) ?? [];
    const starting = graph.getStartingLessons(id);
    if (starting) startingLessons[id] = sortedIds(starting) ?? [];
  }

  const assets: Record<string, unknown> = {};
  for (const [id, m] of library.courses) {
    assets[id] = [m.course_material, m.course_instructions];
  }
  for (const [id, m] of library.lessons) {
    assets[id] = [m.lesson_material, m.lesson_instructions];
  }
  for (const [id, m] of library.exercises) assets[id] = m.exercise_asset;

  return {
    units,
    missing_units: missing,
    dependencies: section((id) => sortedIds(graph.getDependencies(id))),
    dependents: section((id) => sortedIds(graph.getDependents(id))),
    encompasses: section((id) => sortedWeighted(graph.getEncompasses(id))),
    encompassed_by: section((id) => sortedWeighted(graph.getEncompassedBy(id))),
    supersedes: section((id) => sortedIds(graph.getSupersedes(id))),
    superseded_by: section((id) => sortedIds(graph.getSupersededBy(id))),
    lesson_course: lessonCourse,
    lesson_exercises: lessonExercises,
    course_lessons: courseLessons,
    starting_lessons: startingLessons,
    dependency_sinks: sortedIds(graph.getDependencySinks()) ?? [],
    encompassing_equals_dependency: graph.encompassingEqualsDependency(),
    assets,
  };
};

/** Канонический вид: ключи объектов отсортированы. */
const canon = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => compare(a, b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canon(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
};

export interface SectionDiff {
  section: string;
  actualCount: number;
  expectedCount: number;
  differing: number;
  examples: string[];
}

const MAX_EXAMPLES = 3;
const EXAMPLE_LENGTH = 160;

/** Расхождения по секциям (`differing === 0` — секция равна). */
export const diffDumps = (
  actual: Dump,
  expected: Dump,
  sections: readonly string[] = SECTIONS,
  keyFilter: (id: string) => boolean = () => true,
): SectionDiff[] =>
  sections.map((name) => {
    const a = actual[name];
    const e = expected[name];
    const isMap = (v: unknown): v is Record<string, unknown> =>
      v !== null && typeof v === 'object' && !Array.isArray(v);
    if (isMap(a)) {
      const b = isMap(e) ? e : {};
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
        keyFilter,
      );
      const examples: string[] = [];
      let differing = 0;
      for (const key of keys) {
        if (canon(a[key]) === canon(b[key])) continue;
        differing++;
        if (examples.length < MAX_EXAMPLES) {
          examples.push(
            `${key}: actual=${canon(a[key]).slice(0, EXAMPLE_LENGTH)} expected=${canon(b[key]).slice(0, EXAMPLE_LENGTH)}`,
          );
        }
      }
      return {
        section: name,
        actualCount: Object.keys(a).filter(keyFilter).length,
        expectedCount: Object.keys(b).filter(keyFilter).length,
        differing,
        examples,
      };
    }
    const same = canon(a) === canon(e);
    return {
      section: name,
      actualCount: Array.isArray(a) ? a.length : 1,
      expectedCount: Array.isArray(e) ? e.length : 1,
      differing: same ? 0 : 1,
      examples: same
        ? []
        : [
            `actual=${canon(a).slice(0, EXAMPLE_LENGTH)} expected=${canon(e).slice(0, EXAMPLE_LENGTH)}`,
          ],
    };
  });

/**
 * Скелет курсов: отношения только между курсами (Transcription-курсы TS
 * пропускает, их уроки и упражнения в графе Rust лишние).
 */
export const restrictToCourses = (
  dump: Dump,
  courseIds: ReadonlySet<string>,
) => {
  const restricted: Dump = { ...dump };
  const idOf = (item: unknown) =>
    Array.isArray(item) ? String(item[0]) : String(item);
  for (const name of RELATION_SECTIONS) {
    const source = (dump[name] ?? {}) as Record<string, unknown[]>;
    const result: Record<string, unknown[]> = {};
    for (const [key, items] of Object.entries(source)) {
      if (!courseIds.has(key)) continue;
      const kept = items.filter((item) => courseIds.has(idOf(item)));
      if (kept.length > 0) result[key] = kept;
    }
    restricted[name] = result;
  }
  return restricted;
};
