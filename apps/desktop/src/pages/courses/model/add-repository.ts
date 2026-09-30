import { computed, onScopeDispose, ref, shallowRef } from 'vue';
import type { LearningEngine, RepositoryDto } from '@spirula/engine-contract';
import {
  describeRepositoryError,
  isProgressEvent,
  toEngineError,
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
  | { status: 'cancelled' }
  | { status: 'failed' }
  | { status: 'invalid' };

/**
 * Состояние диалога «Добавить из Git». `id` репозитория известен только из
 * первого события `repository-progress`, поэтому отмена, нажатая раньше,
 * запоминается и уходит в `repositories.cancel(id)` с этим событием.
 */
export const useAddRepository = (engine: LearningEngine) => {
  const url = ref('');
  const branch = ref('');
  const running = ref(false);
  const cancelling = ref(false);
  const progress = shallowRef<RepositoryProgress | null>(null);
  const error = shallowRef<RepositoryErrorView | null>(null);
  const urlIssue = ref<UrlIssue | null>(null);
  const refIssue = ref<RefIssue | null>(null);

  let operationId: string | null = null;
  let cancelRequested = false;

  const requestCancel = (id: string) => {
    // отказ отмены не важен: операция завершится сама, итог придёт из `add`
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
  };

  const submit = async (): Promise<AddOutcome> => {
    if (running.value) return { status: 'invalid' };
    urlIssue.value = validateRepositoryUrl(url.value);
    refIssue.value = validateRepositoryRef(branch.value);
    error.value = null;
    if (urlIssue.value !== null || refIssue.value !== null) {
      return { status: 'invalid' };
    }
    const wantedRef = branch.value.trim();
    running.value = true;
    cancelling.value = false;
    cancelRequested = false;
    operationId = null;
    progress.value = null;
    try {
      const repository = await engine.repositories.add({
        url: url.value.trim(),
        ...(wantedRef !== '' && { ref: wantedRef }),
      });
      return { status: 'added', repository };
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
    canSubmit,
    submit,
    cancel,
    reset,
  };
};
