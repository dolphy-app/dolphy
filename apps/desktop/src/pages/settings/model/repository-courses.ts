import { computed, onScopeDispose, shallowRef } from 'vue';
import type {
  LearningEngine,
  RepositoryDto,
  RepositoryPreviewDto,
} from '@dolphy-app/engine-contract';
import {
  describeRepositoryError,
  installedIds,
  isProgressEvent,
  selectableIds,
  toEngineError,
  toggleCourse,
  toProgress,
} from '@/entities/repository';
import type {
  RepositoryErrorView,
  RepositoryProgress,
} from '@/entities/repository';

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((id) => b.has(id));

/**
 * Выбор курсов уже добавленного репозитория: предпросмотр (`repositories.preview`)
 * с отмеченными установленными курсами. Применение — `update(id, {courseIds})`
 * в модели списка репозиториев. Прогресс предпросмотра приходит событиями с
 * `id` репозитория, отмена — `repositories.cancel(id)`.
 */
export const useRepositoryCourses = (engine: LearningEngine) => {
  const target = shallowRef<RepositoryDto | null>(null);
  const preview = shallowRef<RepositoryPreviewDto | null>(null);
  const selected = shallowRef<ReadonlySet<string>>(new Set());
  const loading = shallowRef(false);
  const cancelling = shallowRef(false);
  const progress = shallowRef<RepositoryProgress | null>(null);
  const error = shallowRef<RepositoryErrorView | null>(null);

  let latest = 0;

  const unsubscribe = engine.subscribe((event) => {
    if (!loading.value || !isProgressEvent(event)) return;
    if (event.id === target.value?.id) progress.value = toProgress(event);
  });
  onScopeDispose(unsubscribe);

  const initial = computed(() => installedIds(preview.value?.courses ?? []));
  /** Выбор отличается от установленного: есть что применять. */
  const changed = computed(
    () => preview.value !== null && !sameSet(selected.value, initial.value),
  );
  const canApply = computed(
    () => !loading.value && selected.value.size > 0 && changed.value,
  );

  const load = async (repository: RepositoryDto) => {
    const run = ++latest;
    target.value = repository;
    preview.value = null;
    selected.value = new Set();
    error.value = null;
    progress.value = null;
    cancelling.value = false;
    loading.value = true;
    try {
      const result = await engine.repositories.preview({
        url: repository.url,
        ...(repository.ref !== null && { ref: repository.ref }),
      });
      if (run !== latest) return;
      preview.value = result;
      selected.value = installedIds(result.courses);
    } catch (caught) {
      if (run !== latest) return;
      const view = describeRepositoryError(toEngineError(caught));
      if (!view.cancelled) error.value = view;
    } finally {
      if (run === latest) {
        loading.value = false;
        cancelling.value = false;
        progress.value = null;
      }
    }
  };

  const toggle = (id: string) => {
    selected.value = toggleCourse(
      preview.value?.courses ?? [],
      selected.value,
      id,
    );
  };
  const selectAll = () => {
    selected.value = selectableIds(preview.value?.courses ?? []);
  };
  const clear = () => {
    selected.value = new Set();
  };

  const cancel = () => {
    const repository = target.value;
    if (!loading.value || cancelling.value || repository === null) return;
    cancelling.value = true;
    void engine.repositories.cancel(repository.id).catch(() => false);
  };

  /** Закрытие окна: идущий предпросмотр прерывается, результат отбрасывается. */
  const reset = () => {
    if (loading.value) cancel();
    latest++;
    target.value = null;
    preview.value = null;
    selected.value = new Set();
    error.value = null;
    progress.value = null;
    loading.value = false;
    cancelling.value = false;
  };

  return {
    target,
    preview,
    selected,
    loading,
    cancelling,
    progress,
    error,
    changed,
    canApply,
    load,
    toggle,
    selectAll,
    clear,
    cancel,
    reset,
  };
};
