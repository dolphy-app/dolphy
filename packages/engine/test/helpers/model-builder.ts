/**
 * Ручная сборка `Model` для тестов проверок: минимальные манифесты и карта
 * источников с детерминированными строками (`id` — 2, `dependencies` — 3,
 * `encompassed` — 4, `superseded` — 5, `engine` — 6).
 */
import type { EngineExtension } from '../../src/domain/manifest.ts';
import type {
  CourseUnit,
  ExerciseUnit,
  FieldSrc,
  LessonUnit,
  Model,
} from '../../src/authoring/model.ts';

export interface CourseSpec {
  id: string;
  dependencies?: string[];
  encompassed?: Array<[string, number]>;
  superseded?: string[];
  engine?: EngineExtension;
  /** Каталог курса; по умолчанию `id`. */
  dir?: string;
}

export interface LessonSpec {
  id: string;
  course: string;
  dependencies?: string[];
  encompassed?: Array<[string, number]>;
  superseded?: string[];
  engine?: EngineExtension;
  /** Значение `course_id` в манифесте, если оно отличается от каталога. */
  courseIdInManifest?: string;
}

export interface ExerciseSpec {
  id: string;
  lesson: string;
  engine?: EngineExtension;
  engineBroken?: true;
  lessonIdInManifest?: string;
  courseIdInManifest?: string;
}

export interface ModelSpec {
  courses?: CourseSpec[];
  lessons?: LessonSpec[];
  exercises?: ExerciseSpec[];
  skippedCourses?: string[];
}

const lastSegment = (id: string) => id.split('::').at(-1) as string;

const fieldsOf = (path: string): FieldSrc => ({
  id: { path, line: 2 },
  course_id: { path, line: 2 },
  lesson_id: { path, line: 2 },
  dependencies: { path, line: 3 },
  encompassed: { path, line: 4 },
  superseded: { path, line: 5 },
  engine: { path, line: 6 },
});

const engineOf = (engine: EngineExtension | undefined, path: string) =>
  engine === undefined ? {} : { engine, engineSrc: { path, line: 6 } };

/** Модель, как её отдаёт сканер: у уроков и упражнений каталоги вложены в каталог курса. */
export const buildModel = (spec: ModelSpec): Model => {
  const courseDir = new Map<string, string>();
  const lessonDir = new Map<string, string>();
  const courses = (spec.courses ?? []).map((c): CourseUnit => {
    const dir = c.dir ?? lastSegment(c.id);
    courseDir.set(c.id, dir);
    const path = `${dir}/course_manifest.json`;
    return {
      manifest: {
        id: c.id,
        name: c.id,
        dependencies: c.dependencies ?? [],
        encompassed: c.encompassed ?? [],
        superseded: c.superseded ?? [],
        description: null,
        authors: null,
        metadata: null,
        course_material: null,
        course_instructions: null,
        generator_config: null,
      },
      dir,
      src: { path, line: 2 },
      fields: fieldsOf(path),
      ...engineOf(c.engine, path),
    };
  });
  const lessons = (spec.lessons ?? []).map((l): LessonUnit => {
    const dir = `${courseDir.get(l.course) ?? lastSegment(l.course)}/${lastSegment(l.id)}`;
    lessonDir.set(l.id, dir);
    const path = `${dir}/lesson_manifest.json`;
    return {
      manifest: {
        id: l.id,
        name: l.id,
        course_id: l.courseIdInManifest ?? l.course,
        dependencies: l.dependencies ?? [],
        encompassed: l.encompassed ?? [],
        superseded: l.superseded ?? [],
        description: null,
        metadata: null,
        lesson_material: null,
        lesson_instructions: null,
      },
      dir,
      parentCourseId: l.course,
      src: { path, line: 2 },
      fields: fieldsOf(path),
      ...engineOf(l.engine, path),
    };
  });
  const lessonCourse = new Map(
    lessons.map((l) => [l.manifest.id, l.parentCourseId]),
  );
  const exercises = (spec.exercises ?? []).map((e): ExerciseUnit => {
    const dir = `${lessonDir.get(e.lesson) ?? lastSegment(e.lesson)}/${lastSegment(e.id)}`;
    const path = `${dir}/exercise_manifest.json`;
    const course = lessonCourse.get(e.lesson) ?? '';
    return {
      manifest: {
        id: e.id,
        lesson_id: e.lessonIdInManifest ?? e.lesson,
        course_id: e.courseIdInManifest ?? course,
        name: e.id,
        description: null,
        exercise_type: 'Declarative',
        exercise_asset: {
          InlineFlashcardAsset: { front_content: 'q', back_content: 'a' },
        },
      },
      dir,
      parentLessonId: e.lesson,
      parentCourseId: course,
      src: { path, line: 2 },
      fields: fieldsOf(path),
      ...engineOf(e.engine, path),
      ...(e.engineBroken === true ? { engineBroken: true as const } : {}),
    };
  });
  return {
    courses,
    lessons,
    exercises,
    skippedCourses: spec.skippedCourses ?? [],
  };
};
