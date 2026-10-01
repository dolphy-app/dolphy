import type { UnitId } from '@dolphy-app/engine-contract';
import type { CourseSummary } from '@/entities/course';

/**
 * Курс, который показывает граф. Граф — всегда один курс: несколько курсов
 * подряд читаются хуже одного (масштаб, пустое место), а связи между ними не
 * рисуются. Выбранный курс берётся как есть; без выбора («все курсы» в
 * настройках) — курс с самой свежей попыткой, иначе первый.
 */
export const pickGraphCourse = (
  courses: readonly CourseSummary[],
  activeId: UnitId | null,
): UnitId | null => {
  if (activeId !== null && courses.some(({ id }) => id === activeId)) {
    return activeId;
  }
  let latest: CourseSummary | null = null;
  for (const course of courses) {
    const at = course.lastAttemptAt ?? 0;
    if (at > 0 && at > (latest?.lastAttemptAt ?? 0)) latest = course;
  }
  return (latest ?? courses[0])?.id ?? null;
};
