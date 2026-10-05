import { useQueryCache } from '@pinia/colada';
import type { QueryCache } from '@pinia/colada';
import { computed, onScopeDispose, ref, shallowRef } from 'vue';
import type {
  LearningEngine,
  RepositoryDto,
  RepositoryPreviewDto,
} from '@dolphy-app/engine-contract';
import {
  describeRepositoryError,
  isProgressEvent,
  loadRepositoryPreview,
  selectableIds,
  toEngineError,
  toggleCourse,
  toProgress,
  validateRepositoryRef,
  validateRepositoryUrl,
} from '@/entities/repository';
import type {
  RefIssue,
  RepositoryErrorView,
  RepositoryProgress,
  UrlIssue,
} from '@/entities/repository';

export type AddOutcome =
  | { status: 'added'; repository: RepositoryDto }
  /** Репозиторий скачан для просмотра: показать выбор курсов. */
  | { status: 'choose' }
  | { status: 'cancelled' }
  | { status: 'failed' }
  | { status: 'invalid' };

export type AddStep = 'source' | 'courses';

type Run<T> =
  { status: 'done'; value: T } | { status: 'cancelled' } | { status: 'failed' };

/**
 * Состояние диалога «Добавить из Git»: шаг 1 — адрес, шаг 2 — выбор курсов
 * (`repositories.preview`, затем `add` с `courseIds`). `id` репозитория
 * известен только из первого события `repository-progress`, поэтому отмена,
 * нажатая раньше, запоминается и уходит в `repositories.cancel(id)` с этим
 * событием.
 */
export const useAddRepository = (
  engine: LearningEngine,
  queryCache: QueryCache = useQueryCache(),
) => {
  const url = ref('');
  const branch = ref('');
  const running = ref(false);
  const cancelling = ref(false);
  const progress = shallowRef<RepositoryProgress | null>(null);
  const error = shallowRef<RepositoryErrorView | null>(null);
  const urlIssue = ref<UrlIssue | null>(null);
  const refIssue = ref<RefIssue | null>(null);
  const step = ref<AddStep>('source');
  const preview = shallowRef<RepositoryPreviewDto | null>(null);
  const selected = shallowRef<ReadonlySet<string>>(new Set());

  let operationId: string | null = null;
  let cancelRequested = false;

  const requestCancel = (id: string) => {
    // отказ отмены не важен: операция завершится сама, итог придёт из вызова
    void engine.repositories.cancel(id).catch(() => false);
  };

  const unsubscribe = engine.subscribe((event) => {
    if (!running.value || !isProgressEvent(event)) return;
    // пока нашего `id` нет, им становится id первого события операции
    if (operationId === null) {
      operationId = event.id;
      if (cancelRequested) requestCancel(event.id);
    }
    if (event.id === operationId) progress.value = toProgress(event);
  });
  onScopeDispose(unsubscribe);

  const canSubmit = computed(() => !running.value);
  const canConfirm = computed(() => !running.value && selected.value.size > 0);

  const reset = () => {
    url.value = '';
    branch.value = '';
    progress.value = null;
    error.value = null;
    urlIssue.value = null;
    refIssue.value = null;
    cancelling.value = false;
    cancelRequested = false;
    operationId = null;
    step.value = 'source';
    preview.value = null;
    selected.value = new Set();
  };

  /** Один вызов движка с общим состоянием «идёт, отмена, ошибка». */
  const run = async <T>(call: () => Promise<T>): Promise<Run<T>> => {
    running.value = true;
    cancelling.value = false;
    cancelRequested = false;
    operationId = null;
    progress.value = null;
    error.value = null;
    try {
      return { status: 'done', value: await call() };
    } catch (caught) {
      const view = describeRepositoryError(toEngineError(caught));
      if (cancelRequested || view.cancelled) return { status: 'cancelled' };
      error.value = view;
      return { status: 'failed' };
    } finally {
      running.value = false;
      cancelling.value = false;
      progress.value = null;
    }
  };

  const source = () => {
    const wantedRef = branch.value.trim();
    return {
      url: url.value.trim(),
      ...(wantedRef !== '' && { ref: wantedRef }),
    };
  };

  const add = async (courseIds?: string[]): Promise<AddOutcome> => {
    const result = await run(() =>
      engine.repositories.add({
        ...source(),
        ...(courseIds !== undefined && { courseIds }),
      }),
    );
    return result.status === 'done'
      ? { status: 'added', repository: result.value }
      : result;
  };

  const fail = (view: RepositoryErrorView): AddOutcome => {
    error.value = view;
    return { status: 'failed' };
  };

  /**
   * Шаг 1: проверка ввода и предпросмотр. Репозиторий с одним доступным
   * курсом добавляется сразу; с несколькими — переход к выбору.
   */
  const submit = async (): Promise<AddOutcome> => {
    if (running.value) return { status: 'invalid' };
    urlIssue.value = validateRepositoryUrl(url.value);
    refIssue.value = validateRepositoryRef(branch.value);
    error.value = null;
    if (urlIssue.value !== null || refIssue.value !== null) {
      return { status: 'invalid' };
    }
    const result = await run(() =>
      loadRepositoryPreview(queryCache, engine, source()),
    );
    if (result.status !== 'done') return result;
    const { courses } = result.value;
    if (courses.length === 0) {
      return fail(
        describeRepositoryError({
          code: 'REPOSITORY_REJECTED',
          message: 'Repository contains no courses',
          retryable: false,
          details: { reason: 'no-courses' },
        }),
      );
    }
    if (courses.some((course) => course.installed)) {
      return fail(
        describeRepositoryError({
          code: 'REPOSITORY_EXISTS',
          message: 'Repository is already added',
          retryable: false,
        }),
      );
    }
    const available = selectableIds(courses);
    if (courses.length === 1 && available.size === 1) return add();
    preview.value = result.value;
    selected.value = available;
    step.value = 'courses';
    return { status: 'choose' };
  };

  /** Шаг 2: добавить отмеченные курсы. */
  const confirm = async (): Promise<AddOutcome> => {
    if (!canConfirm.value) return { status: 'invalid' };
    return add([...selected.value]);
  };

  const back = () => {
    if (running.value) return;
    step.value = 'source';
    preview.value = null;
    selected.value = new Set();
    error.value = null;
  };

  const toggle = (id: string) => {
    const courses = preview.value?.courses ?? [];
    selected.value = toggleCourse(courses, selected.value, id);
  };
  const selectAll = () => {
    selected.value = selectableIds(preview.value?.courses ?? []);
  };
  const clear = () => {
    selected.value = new Set();
  };

  const cancel = () => {
    if (!running.value || cancelRequested) return;
    cancelRequested = true;
    cancelling.value = true;
    if (operationId !== null) requestCancel(operationId);
  };

  return {
    url,
    branch,
    running,
    cancelling,
    progress,
    error,
    urlIssue,
    refIssue,
    step,
    preview,
    selected,
    canSubmit,
    canConfirm,
    submit,
    confirm,
    back,
    toggle,
    selectAll,
    clear,
    cancel,
    reset,
  };
};
