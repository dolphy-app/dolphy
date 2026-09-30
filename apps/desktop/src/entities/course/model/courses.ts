import type {
  LearningEngine,
  UnitId,
  UnitStatus,
} from '@spirula-app/engine-contract';
import { readAllPages } from '@/shared/lib/read-all-pages.ts';

export interface CourseSummary {
  id: UnitId;
  name: string;
  description?: string;
  lessonCount: number;
  /** Уроки со статусом `mastered` (оценки прошли порог движка). */
  lessonsDone: number;
  /** Состояние курса в движке; для отображения см. `courseState` на странице курсов. */
  status: UnitStatus;
  attempts: number;
  /** Упражнения курса, которые пора повторить (`R ≤ targetRetention`). */
  due: number;
  lastAttemptAt?: number;
}

/**
 * Курсы библиотеки с прогрессом: `library.listCourses`, `library.listLessons`
 * и `practice.getProgress` (узлы курсов и уроков).
 */
export const loadCourses = async (
  engine: LearningEngine,
): Promise<CourseSummary[]> => {
  const [courses, progress] = await Promise.all([
    readAllPages((req) => engine.library.listCourses(req)),
    readAllPages((req) => engine.practice.getProgress({}, req)),
  ]);
  const byId = new Map(progress.map((node) => [node.id, node]));
  return Promise.all(
    courses.map(async (course): Promise<CourseSummary> => {
      const lessons = await readAllPages((req) =>
        engine.library.listLessons(course.id, req),
      );
      const node = byId.get(course.id);
      return {
        id: course.id,
        name: course.name,
        ...(course.description !== undefined && {
          description: course.description,
        }),
        lessonCount: course.lessonCount,
        lessonsDone: lessons.filter(
          ({ id }) => byId.get(id)?.status === 'mastered',
        ).length,
        status: node?.status ?? 'ready',
        attempts: node?.attempts ?? 0,
        due: node?.dueExercises ?? 0,
        ...(node?.lastAttemptAt !== undefined && {
          lastAttemptAt: node.lastAttemptAt,
        }),
      };
    }),
  );
};
