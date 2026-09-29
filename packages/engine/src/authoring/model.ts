import type {
  CourseManifest,
  EngineExtension,
  ExerciseManifest,
  LessonManifest,
} from '../domain/manifest.ts';

/** Место в исходниках: путь от корня библиотеки (`/`) и строка (1-based). */
export interface Src {
  path: string;
  line?: number;
}

/** Откуда взято поле юнита (для диагностик); нет записи — `src` юнита. */
export type FieldSrc = Partial<Record<string, Src>>;

export interface UnitMeta {
  src: Src;
  fields: FieldSrc;
  /** Проверенное расширение `engine` (frontmatter, ключ манифеста или `lesson.engine.json`). */
  engine?: EngineExtension;
  engineSrc?: Src;
}

export interface CourseUnit extends UnitMeta {
  manifest: CourseManifest;
  dir: string;
}

export interface LessonUnit extends UnitMeta {
  manifest: LessonManifest;
  dir: string;
  parentCourseId: string;
}

export interface ExerciseUnit extends UnitMeta {
  manifest: ExerciseManifest;
  dir: string;
  parentLessonId: string;
  parentCourseId: string;
  /** Ошибка front-файла или блока `engine`: зависимые проверки (`E_NO_VERIFICATION`) подавляются. */
  engineBroken?: true;
}

/** Результат сканирования: манифесты и `engine` до сборки графа. */
export interface Model {
  courses: CourseUnit[];
  lessons: LessonUnit[];
  exercises: ExerciseUnit[];
  /** Курсы с неподдерживаемым генератором: их уроков нет. */
  skippedCourses: string[];
}
