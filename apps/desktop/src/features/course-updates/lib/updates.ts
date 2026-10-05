import type { RepositoryDto, UnitId } from '@dolphy-app/engine-contract';
import { ROUTE } from '@/shared/config/routes.ts';

/** Репозиторий с курсами, у которого на сервере есть более новый коммит. */
export interface CourseUpdate {
  repository: RepositoryDto;
  /** Коммит на сервере (`RepositoryDto.availableCommit`). */
  availableCommit: string;
}

/** Репозитории с доступным обновлением, в порядке списка движка. */
export const updatesOf = (
  repositories: readonly RepositoryDto[],
): CourseUpdate[] =>
  repositories.flatMap((repository) =>
    repository.availableCommit === undefined
      ? []
      : [{ repository, availableCommit: repository.availableCommit }],
  );

/** Репозиторий с обновлением по `id` его курса; курсы без обновления в карту не попадают. */
export const updateByCourse = (
  updates: readonly CourseUpdate[],
): ReadonlyMap<UnitId, CourseUpdate> =>
  new Map(
    updates.flatMap((update) =>
      update.repository.courseIds.map((id) => [id, update] as const),
    ),
  );

/** Одно и то же обновление: репозиторий и коммит сервера; новый коммит — новое обновление. */
export const updateKey = ({ repository, availableCommit }: CourseUpdate) =>
  `${repository.id}@${availableCommit}`;

/**
 * Итог ручной проверки. `found` — обновление нашла эта проверка (`count`
 * репозиториев); `upToDate` — все репозитории сверены, обновлений нет;
 * `unreachable` — часть репозиториев сверить не удалось и новых находок нет
 * (прежняя находка недоступного сервера не в счёт, отсутствие новостей не
 * значит, что курсы актуальны).
 */
export type CheckOutcome =
  | { kind: 'found'; count: number }
  | { kind: 'upToDate' }
  | { kind: 'unreachable' };

/**
 * Сверка сработала для репозитория, если `checkedAt` обновился по сравнению с
 * состоянием до вызова (недоступный сервер оставляет прежнее значение).
 */
export const checkOutcome = (
  before: readonly RepositoryDto[],
  after: readonly RepositoryDto[],
): CheckOutcome => {
  const previous = new Map(before.map(({ id, checkedAt }) => [id, checkedAt]));
  const verified = (item: RepositoryDto) =>
    item.checkedAt !== undefined && item.checkedAt !== previous.get(item.id);
  const found = updatesOf(after).filter(({ repository }) =>
    verified(repository),
  );
  if (found.length > 0) return { kind: 'found', count: found.length };
  return after.every(verified) ? { kind: 'upToDate' } : { kind: 'unreachable' };
};

/** Экраны занятия: уведомление запуска не отвлекает, а ждёт ухода с них. */
const SESSION_ROUTES: ReadonlySet<unknown> = new Set([
  ROUTE.session,
  ROUTE.placement,
]);

export interface AnnouncementStep {
  /** Что показывать после шага (пусто — уведомления нет). */
  shown: readonly CourseUpdate[];
  /** Что считать сообщённым: повторно оно не предлагается, пока коммит сервера тот же. */
  announce: readonly CourseUpdate[];
}

/**
 * Один шаг уведомления при запуске: `shown` — то, что сейчас на экране,
 * `pending` — обновления, о которых ещё не сообщали. На экране «Курсы» то же
 * самое уже видно в плашке: сообщать нечего, всё считается сообщённым. Во время
 * занятия уведомление снимается без отметки и вернётся после ухода с экрана.
 * Показанная пачка не меняется, пока на экране: новые находки ждут очереди.
 */
export const announcementStep = (
  routeName: unknown,
  shown: readonly CourseUpdate[],
  pending: readonly CourseUpdate[],
): AnnouncementStep => {
  if (routeName === ROUTE.courses) {
    return { shown: [], announce: [...shown, ...pending] };
  }
  if (SESSION_ROUTES.has(routeName)) return { shown: [], announce: [] };
  if (shown.length === 0 && pending.length > 0) {
    return { shown: pending, announce: [] };
  }
  return { shown, announce: [] };
};
