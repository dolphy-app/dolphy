/**
 * Курсы снимка репозитория для выбора (спека `repository-course-selection`):
 * каталог, название, зависимости между курсами и диагностики по курсам. Всё
 * чистое поверх модели сканера; источник — каталог `.staging/<opId>`, где
 * репозиторий лежит дочерним каталогом `<repoId>`.
 */
import type {
  Diagnostic,
  RepositoryCourseDto,
} from '@dolphy-app/engine-contract';
import { compile } from '../authoring/compile.ts';
import type { Model } from '../authoring/model.ts';
import { scan } from '../authoring/scan.ts';
import type { CourseSource } from '../ports/index.ts';

/** Сколько текстов ошибок курса попадает в предпросмотр. */
const MAX_COURSE_MESSAGES = 5;

/** Курс снимка: поля предпросмотра, не зависящие от реестра и библиотеки. */
export type SnapshotCourse = Omit<
  RepositoryCourseDto,
  'installed' | 'inLibrary'
>;

/** Каталог курса от корня репозитория; `''` — корень репозитория сам курс. */
const relativeDir = (dir: string, repoId: string): string =>
  dir === repoId ? '' : dir.slice(repoId.length + 1);

const isInside = (dir: string, parent: string): boolean =>
  dir.startsWith(`${parent}/`);

/** Курсы модели в порядке обхода; диагностики пустые (их добавляет `inspectSnapshot`). */
export const describeCourses = (
  model: Model,
  repoId: string,
): SnapshotCourse[] => {
  const ownerOf = new Map<string, string>();
  const lessonCount = new Map<string, number>();
  for (const { manifest } of model.courses)
    ownerOf.set(manifest.id, manifest.id);
  for (const lesson of model.lessons) {
    ownerOf.set(lesson.manifest.id, lesson.parentCourseId);
    lessonCount.set(
      lesson.parentCourseId,
      (lessonCount.get(lesson.parentCourseId) ?? 0) + 1,
    );
  }
  return model.courses.map((course) => {
    const { id, name } = course.manifest;
    const required = new Set<string>();
    const units = [
      course.manifest,
      ...model.lessons
        .filter((lesson) => lesson.parentCourseId === id)
        .map((lesson) => lesson.manifest),
    ];
    for (const unit of units) {
      const targets = [
        ...unit.dependencies,
        ...unit.superseded,
        ...unit.encompassed.map(([target]) => target),
      ];
      for (const target of targets) {
        const owner = ownerOf.get(target);
        if (owner !== undefined && owner !== id) required.add(owner);
      }
    }
    // вложенный курс живёт внутри каталога предка: без предка его не оставить
    for (const other of model.courses) {
      if (isInside(course.dir, other.dir)) required.add(other.manifest.id);
    }
    return {
      id,
      title: name,
      path: relativeDir(course.dir, repoId),
      lessonCount: lessonCount.get(id) ?? 0,
      requires: [...required],
      errors: 0,
      warnings: 0,
      messages: [],
    };
  });
};

/** Курсы и каталоги без проверок графа: достаточно, чтобы обрезать снимок. */
export const scanCourses = async (
  source: CourseSource,
  repoId: string,
): Promise<{ courses: SnapshotCourse[]; dirs: Map<string, string> }> => {
  const { model } = await scan(source, { ignoredPaths: [] });
  const dirs = new Map<string, string>();
  for (const course of model.courses) {
    dirs.set(course.manifest.id, relativeDir(course.dir, repoId));
  }
  return { courses: describeCourses(model, repoId), dirs };
};

/**
 * Курсы снимка с диагностиками сканера и проверок графа: диагностика
 * относится к курсу с самым глубоким каталогом, внутри которого её файл.
 * Диагностики вне каталогов курсов (корневые файлы) ни к кому не относятся.
 */
export const inspectSnapshot = async (
  source: CourseSource,
  repoId: string,
): Promise<SnapshotCourse[]> => {
  const result = await compile(source, {
    scan: { ignoredPaths: [] },
    emit: 'always',
  });
  const courses = describeCourses(result.model, repoId);
  const byDir = result.model.courses
    .map((course, index) => ({ dir: course.dir, course: courses[index]! }))
    .sort((a, b) => b.dir.length - a.dir.length);
  const owner = ({ path }: Diagnostic) =>
    path === undefined
      ? undefined
      : byDir.find(({ dir }) => path === dir || isInside(path, dir))?.course;
  for (const diagnostic of result.diagnostics) {
    const course = owner(diagnostic);
    if (course === undefined) continue;
    if (diagnostic.severity === 'error') {
      course.errors++;
      if (course.messages.length < MAX_COURSE_MESSAGES) {
        course.messages.push(diagnostic.message);
      }
    } else if (diagnostic.severity === 'warning') {
      course.warnings++;
    }
  }
  return courses;
};
