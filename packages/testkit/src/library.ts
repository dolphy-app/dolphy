import type {
  CourseManifest,
  ExerciseManifest,
  LessonManifest,
  Rng,
} from '@lms/engine';
import { createSeededRng } from './rng.ts';

/** Библиотека курсов в памяти: разобранные манифесты (умолчания применены). */
export interface CourseLibrary {
  courses: CourseManifest[];
  lessons: LessonManifest[];
  exercises: ExerciseManifest[];
}

const SEPARATOR = '::';

export const courseIdOf = (course: number) => `course_${course}`;
export const lessonIdOf = (course: number, lesson: number) =>
  `${courseIdOf(course)}${SEPARATOR}lesson_${lesson}`;
export const exerciseIdOf = (
  course: number,
  lesson: number,
  exercise: number,
) => `${lessonIdOf(course, lesson)}${SEPARATOR}exercise_${exercise}`;

const segments = (id: string) => id.split(SEPARATOR);

/** Курс — первый сегмент `course::lesson::exercise`. */
const courseOf = (id: string) => segments(id)[0] as string;
const lessonOf = (exerciseId: string) =>
  segments(exerciseId).slice(0, 2).join(SEPARATOR);

export type CourseFields = Pick<CourseManifest, 'id'> & Partial<CourseManifest>;
export type LessonFields = Pick<LessonManifest, 'id'> & Partial<LessonManifest>;
export type ExerciseFields = Pick<ExerciseManifest, 'id'> &
  Partial<ExerciseManifest>;

export const buildCourse = (fields: CourseFields): CourseManifest => ({
  name: `Course ${fields.id}`,
  dependencies: [],
  encompassed: [],
  superseded: [],
  description: null,
  authors: null,
  metadata: null,
  course_material: null,
  course_instructions: null,
  generator_config: null,
  ...fields,
});

/** `course_id` берётся из первого сегмента `id`, если не задан. */
export const buildLesson = (fields: LessonFields): LessonManifest => ({
  name: `Lesson ${fields.id}`,
  dependencies: [],
  encompassed: [],
  superseded: [],
  course_id: courseOf(fields.id),
  description: null,
  metadata: null,
  lesson_material: null,
  lesson_instructions: null,
  ...fields,
});

/** `lesson_id` и `course_id` выводятся из `id` вида `course::lesson::exercise`. */
export const buildExercise = (fields: ExerciseFields): ExerciseManifest => ({
  name: `Exercise ${fields.id}`,
  lesson_id: lessonOf(fields.id),
  course_id: courseOf(fields.id),
  description: null,
  exercise_type: 'Declarative',
  exercise_asset: {
    FlashcardAsset: { front_path: 'front.md', back_path: 'back.md' },
  },
  ...fields,
});

export interface LessonSpec {
  /** Локальное имя урока; полный id — `<курс>::<имя>`. */
  id: string;
  /** Локальные имена уроков курса или полные id (с `::`). */
  dependencies?: string[];
  /** Число упражнений (`e0`, `e1`, …) или их локальные имена. */
  exercises: number | string[];
}

export interface CourseSpec {
  id: string;
  dependencies?: string[];
  lessons: LessonSpec[];
}

const qualify = (prefix: string, name: string) =>
  name.includes(SEPARATOR) ? name : `${prefix}${SEPARATOR}${name}`;

/** Собирает библиотеку из компактного описания: курсы → уроки → упражнения. */
export const buildLibrary = (spec: {
  courses: CourseSpec[];
}): CourseLibrary => {
  const library: CourseLibrary = { courses: [], lessons: [], exercises: [] };
  for (const course of spec.courses) {
    library.courses.push(
      buildCourse({ id: course.id, dependencies: course.dependencies ?? [] }),
    );
    for (const lesson of course.lessons) {
      const lessonId = qualify(course.id, lesson.id);
      library.lessons.push(
        buildLesson({
          id: lessonId,
          dependencies: (lesson.dependencies ?? []).map((name) =>
            qualify(course.id, name),
          ),
        }),
      );
      const names =
        typeof lesson.exercises === 'number'
          ? Array.from({ length: lesson.exercises }, (_, i) => `e${i}`)
          : lesson.exercises;
      for (const name of names) {
        library.exercises.push(
          buildExercise({ id: `${lessonId}${SEPARATOR}${name}` }),
        );
      }
    }
  }
  return library;
};

export interface SyntheticLibraryOptions {
  courses: number;
  lessonsPerCourse: number;
  exercisesPerLesson: number;
  /** Максимум зависимостей урока (на меньшие индексы урока курса). По умолчанию 3. */
  maxDependencies?: number;
  /** Курс `c` зависит от курса `c - 1` (без циклов). По умолчанию `false`. */
  chainCourses?: boolean;
  seed?: number;
  rng?: Rng;
}

/**
 * Синтетическая библиотека заданной формы. Зависимости урока — случайное
 * подмножество уроков того же курса с меньшим индексом, поэтому граф
 * ациклический при любом seed; один seed — одна библиотека.
 */
export const generateLibrary = ({
  courses,
  lessonsPerCourse,
  exercisesPerLesson,
  maxDependencies = 3,
  chainCourses = false,
  seed = 1,
  rng = createSeededRng(seed),
}: SyntheticLibraryOptions): CourseLibrary => {
  const library: CourseLibrary = { courses: [], lessons: [], exercises: [] };
  for (let c = 0; c < courses; c++) {
    library.courses.push(
      buildCourse({
        id: courseIdOf(c),
        dependencies: chainCourses && c > 0 ? [courseIdOf(c - 1)] : [],
      }),
    );
    for (let l = 0; l < lessonsPerCourse; l++) {
      const count = rng.range(0, Math.min(maxDependencies, l) + 1);
      const earlier = Array.from({ length: l }, (_, i) => i);
      const picked = rng.sample(earlier, count).sort((a, b) => a - b);
      library.lessons.push(
        buildLesson({
          id: lessonIdOf(c, l),
          dependencies: picked.map((i) => lessonIdOf(c, i)),
        }),
      );
      for (let e = 0; e < exercisesPerLesson; e++) {
        library.exercises.push(
          buildExercise({
            id: exerciseIdOf(c, l, e),
            exercise_type: e % 2 === 0 ? 'Declarative' : 'Procedural',
          }),
        );
      }
    }
  }
  return library;
};
