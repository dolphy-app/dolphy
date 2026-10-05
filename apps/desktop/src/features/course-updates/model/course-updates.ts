import { computed, shallowRef } from 'vue';
import type { ComputedRef, InjectionKey, Ref, ShallowRef } from 'vue';
import type {
  LearningEngine,
  RepositoryDto,
  UnitId,
} from '@dolphy-app/engine-contract';
import {
  clearProgress,
  describeRepositoryError,
  isProgressEvent,
  reduceProgress,
  toEngineError,
} from '@/entities/repository';
import type {
  RepositoryErrorView,
  RepositoryProgress,
} from '@/entities/repository';
import {
  checkOutcome,
  updateByCourse,
  updateKey,
  updatesOf,
} from '../lib/updates.ts';
import type { CheckOutcome, CourseUpdate } from '../lib/updates.ts';

export interface CourseUpdateFailure {
  /** Репозиторий, обновление которого отклонено. */
  id: string;
  view: RepositoryErrorView;
}

export interface CourseUpdates {
  /** Репозитории библиотеки с результатом последней проверки. */
  readonly repositories: Readonly<ShallowRef<readonly RepositoryDto[]>>;
  /** Репозитории с более новым коммитом на сервере. */
  readonly updates: ComputedRef<readonly CourseUpdate[]>;
  /** Обновление репозитория курса; `undefined` — курс из другого источника или актуален. */
  updateOf(courseId: UnitId): CourseUpdate | undefined;
  /** Название курса для показа: из библиотеки, иначе `id`. */
  courseName(courseId: UnitId): string;
  /** Идёт ручная проверка. */
  readonly checking: Readonly<Ref<boolean>>;
  /** Сверяет репозитории с сервером; `null` — проверка уже идёт, сбой вызова — `unreachable`. */
  check(): Promise<CheckOutcome | null>;
  /** Репозиторий с идущим обновлением. */
  readonly pendingId: Readonly<Ref<string | null>>;
  /** Ход обновления по `id` репозитория. */
  readonly progress: Readonly<
    ShallowRef<Readonly<Record<string, RepositoryProgress>>>
  >;
  /** Последний отказ обновления; сбрасывается новым обновлением. */
  readonly failure: Readonly<ShallowRef<CourseUpdateFailure | null>>;
  update(id: string): Promise<void>;
  /** Обновления, о которых окно ещё не сообщило при запуске. */
  readonly unannounced: ComputedRef<readonly CourseUpdate[]>;
  /** Запоминает сообщённые обновления: повторно они не предлагаются, пока коммит сервера тот же. */
  markAnnounced(updates: readonly CourseUpdate[]): void;
  /** Движок перезапущен (новый порт): список читается заново. */
  reconnected(): Promise<void>;
  /** Отписывается от событий движка. */
  dispose(): void;
}

export const COURSE_UPDATES_KEY: InjectionKey<CourseUpdates> =
  Symbol('course-updates');

export interface CourseUpdatesDeps {
  /** Курсы библиотеки (названия для показа). */
  courseNames(): ReadonlyMap<UnitId, string>;
}

/**
 * Доступные обновления курсов из git для плашки на экране «Курсы», уведомления
 * при запуске и пометки на карточках. Читает `repositories.list()` при создании,
 * после `repository-updates-checked` и `library-reloaded` (обновление из любого
 * места сбрасывает пометку) и после переподключения; устаревший ответ
 * отбрасывается, сбой чтения оставляет прежний список.
 */
export const createCourseUpdates = (
  engine: LearningEngine,
  { courseNames }: CourseUpdatesDeps,
): CourseUpdates => {
  const repositories = shallowRef<readonly RepositoryDto[]>([]);
  const checking = shallowRef(false);
  const pendingId = shallowRef<string | null>(null);
  const progress = shallowRef<Readonly<Record<string, RepositoryProgress>>>({});
  const failure = shallowRef<CourseUpdateFailure | null>(null);
  const announced = shallowRef<ReadonlySet<string>>(new Set());
  let latest = 0;

  const updates = computed(() => updatesOf(repositories.value));
  const byCourse = computed(() => updateByCourse(updates.value));
  const unannounced = computed(() =>
    updates.value.filter((update) => !announced.value.has(updateKey(update))),
  );

  const refresh = async (): Promise<void> => {
    const request = ++latest;
    try {
      const next = await engine.repositories.list();
      if (request === latest) repositories.value = next;
    } catch (error) {
      if (request === latest) {
        console.error({ error }, 'course updates were not loaded');
      }
    }
  };

  const check = async (): Promise<CheckOutcome | null> => {
    if (checking.value) return null;
    checking.value = true;
    const before = repositories.value;
    try {
      const after = await engine.repositories.checkUpdates();
      // ответ новее любого чтения, начатого до него
      latest++;
      repositories.value = after;
      return checkOutcome(before, after);
    } catch (error) {
      console.error({ error }, 'course updates check failed');
      return { kind: 'unreachable' };
    } finally {
      checking.value = false;
    }
  };

  const update = async (id: string): Promise<void> => {
    if (pendingId.value !== null) return;
    pendingId.value = id;
    failure.value = null;
    try {
      await engine.repositories.update(id);
    } catch (caught) {
      const view = describeRepositoryError(toEngineError(caught));
      if (!view.cancelled) failure.value = { id, view };
    } finally {
      pendingId.value = null;
      progress.value = clearProgress(progress.value, id);
      // отказ записывает `lastError`, успех сбрасывает пометку: читаем заново
      await refresh();
    }
  };

  const markAnnounced = (shown: readonly CourseUpdate[]): void => {
    announced.value = new Set([...announced.value, ...shown.map(updateKey)]);
  };

  const unsubscribe = engine.subscribe((event) => {
    if (isProgressEvent(event)) {
      progress.value = reduceProgress(progress.value, event);
    } else if (
      event.type === 'repository-updates-checked' ||
      event.type === 'library-reloaded'
    ) {
      // слушатель не вызывает команды синхронно (API §7)
      queueMicrotask(() => void refresh());
    }
  });

  void refresh();
  return {
    repositories,
    updates,
    updateOf: (courseId) => byCourse.value.get(courseId),
    courseName: (courseId) => courseNames().get(courseId) ?? courseId,
    checking,
    check,
    pendingId,
    progress,
    failure,
    update,
    unannounced,
    markAnnounced,
    reconnected: refresh,
    dispose: unsubscribe,
  };
};
