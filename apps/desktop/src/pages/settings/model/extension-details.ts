import { computed, onScopeDispose, ref, shallowRef, toValue, watch } from 'vue';
import type { ComputedRef, MaybeRefOrGetter, Ref, ShallowRef } from 'vue';
import type {
  CatalogEntryDto,
  ExtensionDocsDto,
  ExtensionInfoDto,
  ExtensionUpdateDto,
  LearningEngine,
} from '@dolphy-app/engine-contract';
import { toEngineError } from '@/entities/repository';
import { describeDetails } from '../lib/extension-details.ts';
import type { ExtensionDetails } from '../lib/extension-details.ts';

/** `loading` — первое чтение; `failed` — список расширений не получен. */
export type DetailsState = 'loading' | 'ready' | 'failed';

/**
 * Описание версии: `loading`; `ready` — тексты получены (`docs.source` говорит,
 * откуда); `failed` — недоступны (нет сети и кэша, подмена файла, превышены размеры).
 */
export type DocsState =
  | { status: 'loading' }
  | { status: 'ready'; docs: ExtensionDocsDto }
  | { status: 'failed'; message: string; reason: string | null };

export interface ExtensionDetailsModel {
  state: Ref<DetailsState>;
  /** Страница расширения; `null` — расширения нет ни среди установленных, ни в каталоге. */
  details: ComputedRef<ExtensionDetails | null>;
  docs: ShallowRef<DocsState>;
  /** Причина, по которой каталог не прочитан; `null` — каталог получен (в том числе из кэша). */
  catalogError: Ref<string | null>;
  /** Показан сохранённый индекс: свежий получить не удалось. */
  catalogStale: Ref<boolean>;
  /** Ошибка чтения списка расширений при `state: 'failed'`. */
  error: Ref<string | null>;
  load(): Promise<void>;
  /** «Повторить» под README. */
  retryDocs(): Promise<void>;
}

const versionOf = (value: string | null | undefined): string | null =>
  typeof value === 'string' && /^\d+\.\d+\.\d+/.test(value) ? value : null;

/**
 * Установленная запись расширения: действующая (не перекрытая другим
 * источником), иначе первая с этим id.
 */
const installedOf = (
  list: readonly ExtensionInfoDto[],
  id: string,
): ExtensionInfoDto | null => {
  const found = list.filter((item) => item.id === id);
  return found.find((item) => item.state !== 'overridden') ?? found[0] ?? null;
};

/**
 * Страница расширения: установленное (`extensions.list`), запись каталога
 * (`extensions.catalog`), обновление (`extensions.updates`) и описание версии
 * (`extensions.docs`). Сопоставление — по id. Нет каталога — страница показывает
 * только установленное; сбой описания не прячет остальное. `extensions-changed` и
 * `contributions-changed` перечитывают данные; описание — только если версия не
 * выбрана (выбранную автором страницы версию изменение набора не затрагивает).
 * Смена `id` или `version` перечитывает описание; ответ устаревшего запроса
 * отбрасывается.
 */
export const useExtensionDetails = (
  engine: LearningEngine,
  id: MaybeRefOrGetter<string>,
  version: MaybeRefOrGetter<string | null>,
): ExtensionDetailsModel => {
  const state = ref<DetailsState>('loading');
  const error = ref<string | null>(null);
  const info = shallowRef<ExtensionInfoDto | null>(null);
  const entry = shallowRef<CatalogEntryDto | null>(null);
  const update = shallowRef<ExtensionUpdateDto | null>(null);
  const catalogError = ref<string | null>(null);
  const catalogStale = ref(false);
  const docs = shallowRef<DocsState>({ status: 'loading' });
  let lastLoad = 0;
  let lastDocs = 0;

  const selected = computed(() => versionOf(toValue(version)));

  const details = computed(() =>
    describeDetails(
      toValue(id),
      info.value,
      entry.value,
      update.value,
      docs.value.status === 'ready' ? docs.value.docs.version : selected.value,
    ),
  );

  /** `quiet` — обновление без мигания: показанный текст остаётся, пока не придёт новый. */
  const loadDocs = async (quiet = false) => {
    lastDocs += 1;
    const request = lastDocs;
    const wanted = selected.value;
    if (!quiet) docs.value = { status: 'loading' };
    try {
      const result = await engine.extensions.docs(
        toValue(id),
        wanted === null ? undefined : { version: wanted },
      );
      if (request === lastDocs) docs.value = { status: 'ready', docs: result };
    } catch (caught) {
      if (request !== lastDocs) return;
      const failure = toEngineError(caught);
      const reason = failure.details?.['reason'];
      docs.value = {
        status: 'failed',
        message: failure.message,
        reason: typeof reason === 'string' ? reason : null,
      };
    }
  };

  /** `withDocs` — перечитать и описание; `quiet` — без мигания (изменение набора расширений). */
  const read = async (withDocs: boolean, quiet = false) => {
    lastLoad += 1;
    const request = lastLoad;
    const wanted = toValue(id);
    try {
      const [list, available, catalog] = await Promise.all([
        engine.extensions.list(),
        engine.extensions.updates().catch(() => []),
        engine.extensions
          .catalog()
          .then((value) => ({ value, error: null }))
          .catch((caught: unknown) => ({
            value: null,
            error: toEngineError(caught).message,
          })),
      ]);
      if (request !== lastLoad) return;
      info.value = installedOf(list, wanted);
      update.value = available.find((item) => item.id === wanted) ?? null;
      entry.value =
        catalog.value?.entries.find((item) => item.id === wanted) ?? null;
      catalogError.value = catalog.error;
      catalogStale.value = catalog.value?.stale ?? false;
      error.value = null;
      state.value = 'ready';
    } catch (caught) {
      if (request !== lastLoad) return;
      error.value = toEngineError(caught).message;
      if (state.value === 'loading') state.value = 'failed';
      return;
    }
    if (withDocs && details.value !== null) await loadDocs(quiet);
  };

  const load = () => read(true);
  const retryDocs = () =>
    details.value === null ? Promise.resolve() : loadDocs();

  // другая страница или версия: данные прежней не показываются, описание читается заново
  watch(
    () => toValue(id),
    () => {
      state.value = 'loading';
      info.value = null;
      entry.value = null;
      update.value = null;
      docs.value = { status: 'loading' };
      void read(true);
    },
  );
  watch(selected, () => {
    if (state.value === 'ready' && details.value !== null) void loadDocs();
  });

  const unsubscribe = engine.subscribe((event) => {
    if (
      event.type !== 'extensions-changed' &&
      event.type !== 'contributions-changed'
    ) {
      return;
    }
    // слушатель не вызывает команды синхронно (API §7)
    queueMicrotask(() => void read(selected.value === null, true));
  });
  onScopeDispose(unsubscribe);

  void load();
  return {
    state,
    details,
    docs,
    catalogError,
    catalogStale,
    error,
    load,
    retryDocs,
  };
};
