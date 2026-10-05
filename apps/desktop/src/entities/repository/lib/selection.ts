import type { RepositoryCourseDto } from '@dolphy-app/engine-contract';

/** Почему курс нельзя отметить; текст выбирает компонент через i18n. */
export type CourseBlock =
  /** В каталоге курса есть ошибки сканера. */
  | 'errors'
  /** Курс с таким `id` уже в библиотеке из другого источника. */
  | 'in-library'
  /** Курсу нужен недоступный курс того же репозитория. */
  | 'requires-blocked';

const own = (course: RepositoryCourseDto): CourseBlock | null => {
  if (course.errors > 0) return 'errors';
  if (course.inLibrary) return 'in-library';
  return null;
};

/**
 * Недоступность курсов: собственная (ошибки, конфликт `id`) и по
 * транзитивной цепочке `requires`: курс, которому нужен недоступный курс,
 * недоступен тоже.
 */
export const blockedCourses = (
  courses: readonly RepositoryCourseDto[],
): Map<string, CourseBlock> => {
  const blocked = new Map<string, CourseBlock>();
  for (const course of courses) {
    const reason = own(course);
    if (reason !== null) blocked.set(course.id, reason);
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const course of courses) {
      if (blocked.has(course.id)) continue;
      if (course.requires.some((id) => blocked.has(id))) {
        blocked.set(course.id, 'requires-blocked');
        changed = true;
      }
    }
  }
  return blocked;
};

/** Курс и всё, без чего он не загрузится (транзитивно). */
const closureOf = (
  byId: ReadonlyMap<string, RepositoryCourseDto>,
  start: string,
): Set<string> => {
  const seen = new Set<string>();
  const pending = [start];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...(byId.get(id)?.requires ?? []));
  }
  return seen;
};

const indexOf = (courses: readonly RepositoryCourseDto[]) =>
  new Map(courses.map((course) => [course.id, course]));

/** Все доступные курсы (стартовый выбор диалога добавления и «Выбрать все»). */
export const selectableIds = (
  courses: readonly RepositoryCourseDto[],
): Set<string> => {
  const blocked = blockedCourses(courses);
  return new Set(
    courses.filter(({ id }) => !blocked.has(id)).map(({ id }) => id),
  );
};

/** Установленные курсы, которые ещё можно поставить: стартовый выбор диалога настроек. */
export const installedIds = (
  courses: readonly RepositoryCourseDto[],
): Set<string> => {
  const selectable = selectableIds(courses);
  return new Set(
    courses
      .filter(({ id, installed }) => installed && selectable.has(id))
      .map(({ id }) => id),
  );
};

/**
 * Курсы, которые удерживают `id` отмеченным: отмеченные курсы, которым он
 * нужен. Пока такие есть, `id` снять нельзя.
 */
export const requiredBy = (
  courses: readonly RepositoryCourseDto[],
  selected: ReadonlySet<string>,
): Map<string, string[]> => {
  const holders = new Map<string, string[]>();
  for (const course of courses) {
    if (!selected.has(course.id)) continue;
    for (const need of course.requires) {
      holders.set(need, [...(holders.get(need) ?? []), course.id]);
    }
  }
  return holders;
};

/**
 * Отметка курса: отмечает его и всё, что ему нужно; снятие разрешено, только
 * если никто из отмеченных его не требует. Недоступный курс не меняется.
 */
export const toggleCourse = (
  courses: readonly RepositoryCourseDto[],
  selected: ReadonlySet<string>,
  id: string,
): Set<string> => {
  const next = new Set(selected);
  if (blockedCourses(courses).has(id)) return next;
  if (!next.has(id)) {
    for (const need of closureOf(indexOf(courses), id)) next.add(need);
    return next;
  }
  if (requiredBy(courses, next).has(id)) return next;
  next.delete(id);
  return next;
};
