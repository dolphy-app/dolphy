import type { UnitId } from '@spirula-app/engine-contract';
import type {
  BlacklistView,
  ScoringEdge,
  ScoringGraph,
  UnitKind,
} from '../../src/scoring/index.ts';

/** Аналог `TestLesson`/`TestCourse` из `test_utils.rs`: id вида `курс::урок::упр`. */
export interface LessonSpec {
  id: UnitId;
  dependencies?: UnitId[];
  encompassed?: ScoringEdge[];
  superseded?: UnitId[];
  /** Число упражнений (`<урок>::0`, `<урок>::1`, …) или явные id. */
  exercises?: number | UnitId[];
}

export interface CourseSpec {
  id: UnitId;
  dependencies?: UnitId[];
  encompassed?: ScoringEdge[];
  superseded?: UnitId[];
  lessons: LessonSpec[];
}

export interface TestGraph extends ScoringGraph {
  exerciseIds(): UnitId[];
}

const exerciseIdsOf = (lesson: LessonSpec) => {
  const { exercises = 0 } = lesson;
  if (typeof exercises !== 'number') return exercises;
  return Array.from({ length: exercises }, (_, i) => `${lesson.id}::${i}`);
};

/**
 * Граф по спецификации. Как загрузчик Trane, вызывает `add_encompassed` для
 * каждого юнита: явные рёбра плюс зависимости с весом 1.0, которых нет среди
 * явных. Порядок рёбер — порядок добавления.
 */
export const createTestGraph = (courses: readonly CourseSpec[]): TestGraph => {
  const kinds = new Map<UnitId, UnitKind>();
  const lessonCourse = new Map<UnitId, UnitId>();
  const courseLessons = new Map<UnitId, UnitId[]>();
  const lessonExercises = new Map<UnitId, UnitId[]>();
  const exerciseLesson = new Map<UnitId, UnitId>();
  const encompasses = new Map<UnitId, ScoringEdge[]>();
  const encompassedBy = new Map<UnitId, ScoringEdge[]>();
  const supersededBy = new Map<UnitId, Set<UnitId>>();

  const addUnit = (
    unit: Omit<CourseSpec, 'lessons'> | LessonSpec,
    kind: UnitKind,
  ) => {
    kinds.set(unit.id, kind);
    const explicit = unit.encompassed ?? [];
    const edges: ScoringEdge[] = [...explicit];
    for (const dependency of unit.dependencies ?? []) {
      if (!explicit.some(([id]) => id === dependency)) {
        edges.push([dependency, 1.0]);
      }
    }
    encompasses.set(unit.id, edges);
    for (const [id, weight] of edges) {
      const owners = encompassedBy.get(id) ?? [];
      owners.push([unit.id, weight]);
      encompassedBy.set(id, owners);
    }
    for (const superseded of unit.superseded ?? []) {
      const owners = supersededBy.get(superseded) ?? new Set<UnitId>();
      owners.add(unit.id);
      supersededBy.set(superseded, owners);
    }
  };

  for (const course of courses) {
    addUnit(course, 'course');
    courseLessons.set(
      course.id,
      course.lessons.map((lesson) => lesson.id),
    );
    for (const lesson of course.lessons) {
      addUnit(lesson, 'lesson');
      lessonCourse.set(lesson.id, course.id);
      const exercises = exerciseIdsOf(lesson);
      lessonExercises.set(lesson.id, exercises);
      for (const exerciseId of exercises) {
        kinds.set(exerciseId, 'exercise');
        exerciseLesson.set(exerciseId, lesson.id);
      }
    }
  }

  return {
    getUnitType: (id) => kinds.get(id) ?? null,
    getExerciseLesson: (id) => exerciseLesson.get(id) ?? null,
    getLessonCourse: (id) => lessonCourse.get(id) ?? null,
    getLessonExercises: (id) => lessonExercises.get(id) ?? null,
    getCourseLessons: (id) => courseLessons.get(id) ?? null,
    getEncompasses: (id) => encompasses.get(id) ?? null,
    getEncompassedBy: (id) => encompassedBy.get(id) ?? null,
    getSupersededBy: (id) => supersededBy.get(id) ?? null,
    exerciseIds: () => [...exerciseLesson.keys()],
  };
};

/** `TEST_LIBRARY` из `unit_scorer.rs`: 2 курса × 2 урока × 2 упражнения. */
export const createUnitScorerLibrary = () =>
  createTestGraph([
    {
      id: '0',
      lessons: [
        { id: '0::0', exercises: 2 },
        { id: '0::1', dependencies: ['0::0'], exercises: 2 },
      ],
    },
    {
      id: '1',
      dependencies: ['0'],
      superseded: ['0'],
      lessons: [
        { id: '1::0', exercises: 2 },
        {
          id: '1::1',
          dependencies: ['1::0'],
          superseded: ['1::0'],
          exercises: 2,
        },
      ],
    },
  ]);

export const createBlacklist = (
  initial: readonly UnitId[] = [],
): BlacklistView & { add(unitId: UnitId): void } => {
  const units = new Set(initial);
  return {
    isBlacklisted: (unitId) => units.has(unitId),
    add: (unitId) => {
      units.add(unitId);
    },
  };
};
