import { computed, onScopeDispose, ref, shallowRef } from 'vue';
import type { ComputedRef, Ref, ShallowRef } from 'vue';
import type {
  CatalogSourceDto,
  CatalogUrlRejection,
  ExtensionSettingsDto,
  LearningEngine,
} from '@dolphy-app/engine-contract';
import { toEngineError } from '@/entities/repository';
import { catalogUrlRejection } from '../lib/catalog-source.ts';

/** Ошибка рядом с полем: причина отказа адреса или текст ошибки движка. */
export type CatalogAddressError =
  | { kind: 'rejected'; reason: CatalogUrlRejection }
  | { kind: 'failed'; message: string };

export interface CatalogSourceModel {
  /** Действующий адрес каталога; `null` — ещё не прочитан. */
  source: ShallowRef<CatalogSourceDto | null>;
  /** Поле «Адрес каталога»: черновик, пока не применён. */
  draft: Ref<string>;
  error: Ref<CatalogAddressError | null>;
  busy: Ref<boolean>;
  /** Адрес задан переменной окружения: поле неактивно. */
  locked: ComputedRef<boolean>;
  /** «Применить»: в поле другой адрес, чем действующий, и это не пусто. */
  canApply: ComputedRef<boolean>;
  /** «Сбросить»: действует свой адрес из настройки. */
  canReset: ComputedRef<boolean>;
  load(): Promise<void>;
  /** `true` — адрес принят движком и действует. */
  apply(): Promise<boolean>;
  reset(): Promise<boolean>;
}

/**
 * Адрес каталога расширений (`extensions.catalogSource`, `extensions.setCatalogUrl`).
 * Действующий адрес перечитывается при `settings-changed` и `extensions-changed`,
 * ответ устаревшего чтения отбрасывается; неверный адрес не меняет поле и
 * действующее значение.
 */
export const useCatalogSource = (
  engine: LearningEngine,
): CatalogSourceModel => {
  const source = shallowRef<CatalogSourceDto | null>(null);
  const draft = ref('');
  const error = ref<CatalogAddressError | null>(null);
  const busy = ref(false);
  let lastRead = 0;

  const locked = computed(() => source.value?.origin === 'env');
  const canApply = computed(() => {
    const text = draft.value.trim();
    return (
      source.value !== null &&
      !locked.value &&
      !busy.value &&
      text !== '' &&
      text !== source.value.url
    );
  });
  const canReset = computed(
    () => source.value?.origin === 'setting' && !busy.value,
  );

  const read = async (): Promise<void> => {
    lastRead += 1;
    const request = lastRead;
    try {
      const next = await engine.extensions.catalogSource();
      if (request !== lastRead) return;
      const wasShowing = source.value?.url ?? null;
      source.value = next;
      // поле следует за действующим адресом, пока пользователь не начал править своё
      if (draft.value === '' || draft.value === wasShowing) {
        draft.value = next.url;
      }
    } catch (caught) {
      if (request === lastRead) {
        error.value = {
          kind: 'failed',
          message: toEngineError(caught).message,
        };
      }
    }
  };

  const change = async (url: string | null): Promise<boolean> => {
    busy.value = true;
    error.value = null;
    let saved: ExtensionSettingsDto;
    try {
      saved = await engine.extensions.setCatalogUrl(url);
    } catch (caught) {
      const failure = toEngineError(caught);
      const reason =
        failure.code === 'INVALID_ARGUMENT'
          ? catalogUrlRejection(failure.details)
          : null;
      error.value =
        reason === null
          ? { kind: 'failed', message: failure.message }
          : { kind: 'rejected', reason };
      busy.value = false;
      return false;
    }
    // поле показывает принятый адрес в каноническом виде (после сброса — умолчание);
    // из ответа, а не из чтения: параллельное чтение по событию отбросило бы это
    draft.value = saved.catalogUrl ?? source.value?.default ?? draft.value;
    await read();
    busy.value = false;
    return true;
  };

  const unsubscribe = engine.subscribe((event) => {
    // слушатель не вызывает команды синхронно (API §7)
    if (
      event.type === 'extensions-changed' ||
      (event.type === 'settings-changed' && event.scope === 'extensions')
    ) {
      queueMicrotask(() => void read());
    }
  });
  onScopeDispose(unsubscribe);

  return {
    source,
    draft,
    error,
    busy,
    locked,
    canApply,
    canReset,
    load: read,
    apply: () => change(draft.value.trim()),
    reset: () => change(null),
  };
};
