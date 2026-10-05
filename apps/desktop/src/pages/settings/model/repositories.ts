import { computed, onScopeDispose, ref, shallowRef } from 'vue';
import type {
  LearningEngine,
  RepositoryDto,
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

/** Итог действия над репозиторием; текст выбирает компонент через i18n. */
export type RepositoryNotice =
  | { kind: 'upToDate' }
  | { kind: 'updated'; courses: number }
  | { kind: 'removed' };

/** Список репозиториев библиотеки и действия «Обновить» / «Удалить». */
export const useRepositories = (engine: LearningEngine) => {
  const items = shallowRef<RepositoryDto[]>([]);
  const loaded = ref(false);
  const progress = shallowRef<Record<string, RepositoryProgress>>({});
  /** Репозиторий с идущим действием; операции движка идут по очереди. */
  const pendingId = ref<string | null>(null);
  const cancelling = ref(false);
  const notice = shallowRef<RepositoryNotice | null>(null);
  const error = shallowRef<RepositoryErrorView | null>(null);

  const busy = computed(() => pendingId.value !== null);

  let latestRead = 0;
  const refresh = async () => {
    const read = ++latestRead;
    try {
      const list = await engine.repositories.list();
      if (read !== latestRead) return;
      items.value = list;
      loaded.value = true;
    } catch (caught) {
      if (read === latestRead) {
        error.value = describeRepositoryError(toEngineError(caught));
      }
    }
  };

  const run = async (id: string, action: () => Promise<void>) => {
    if (busy.value) return;
    pendingId.value = id;
    cancelling.value = false;
    notice.value = null;
    error.value = null;
    try {
      await action();
    } catch (caught) {
      const view = describeRepositoryError(toEngineError(caught));
      if (!view.cancelled) error.value = view;
    } finally {
      pendingId.value = null;
      cancelling.value = false;
      progress.value = clearProgress(progress.value, id);
      // отказ записывает `lastError`, отмена меняет статус: читаем заново
      await refresh();
    }
  };

  /** `courseIds` заменяет выбор курсов репозитория; без него — обычное обновление. */
  const update = (id: string, courseIds?: string[]) =>
    run(id, async () => {
      const result =
        courseIds === undefined
          ? await engine.repositories.update(id)
          : await engine.repositories.update(id, { courseIds });
      notice.value = result.changed
        ? { kind: 'updated', courses: result.repository.courseIds.length }
        : { kind: 'upToDate' };
    });

  const remove = (id: string) =>
    run(id, async () => {
      await engine.repositories.remove(id);
      notice.value = { kind: 'removed' };
    });

  const cancel = async (id: string) => {
    if (pendingId.value !== id || cancelling.value) return;
    cancelling.value = true;
    await engine.repositories.cancel(id).catch(() => false);
  };

  const dismissNotice = () => {
    notice.value = null;
  };

  const unsubscribe = engine.subscribe((event) => {
    if (isProgressEvent(event)) {
      progress.value = reduceProgress(progress.value, event);
    } else if (event.type === 'library-reloaded' && !busy.value) {
      // слушатель не вызывает команды синхронно (API §7)
      queueMicrotask(() => void refresh());
    }
  });
  onScopeDispose(unsubscribe);
  void refresh();

  return {
    items,
    loaded,
    progress,
    pendingId,
    cancelling,
    busy,
    notice,
    error,
    refresh,
    update,
    remove,
    cancel,
    dismissNotice,
  };
};
