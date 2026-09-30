import { computed, onScopeDispose, ref, shallowRef } from 'vue';
import type { ComputedRef, Ref, ShallowRef } from 'vue';
import type {
  CatalogDto,
  CatalogEntryDto,
  LearningEngine,
} from '@spirula-app/engine-contract';
import { toEngineError } from '@/entities/repository';
import { filterEntries, hasActiveFilters } from '../lib/catalog.ts';
import type { ContributionPoint } from '../lib/catalog.ts';

/** `idle` — вкладку ещё не открывали, индекс не запрашивался. */
export type CatalogState = 'idle' | 'loading' | 'loaded' | 'failed';

export interface CatalogModel {
  state: Ref<CatalogState>;
  entries: ShallowRef<CatalogEntryDto[]>;
  /** Записи под поиском и фильтрами, в порядке движка. */
  visible: ComputedRef<CatalogEntryDto[]>;
  query: Ref<string>;
  kinds: ShallowRef<ReadonlySet<ContributionPoint>>;
  isFiltered: ComputedRef<boolean>;
  /** Показан сохранённый индекс: свежий получить не удалось. */
  stale: Ref<boolean>;
  /** Короткая причина из ответа движка или текст ошибки; `null` — без ошибок. */
  notice: Ref<string | null>;
  /** ISO-время получения индекса. */
  fetchedAt: Ref<string | null>;
  /** Идёт запрос при уже показанных данных (обновление). */
  busy: Ref<boolean>;
  /** Ошибка первой загрузки: каталог недоступен и кэша нет. */
  failure: Ref<string | null>;
  /** Первая загрузка; повторные вызовы ничего не делают. */
  open(): Promise<void>;
  load(options?: { refresh?: boolean }): Promise<void>;
  setKind(point: ContributionPoint, on: boolean): void;
  resetFilters(): void;
}

/**
 * Каталог расширений (`extensions.catalog`): индекс читается целиком при
 * первом открытии вкладки, поиск и фильтры работают на клиенте. Обновление
 * не прячет показанные записи, ответ устаревшего запроса отбрасывается.
 * `extensions-changed` (установка, удаление, проверка обновлений) перечитывает
 * каталог без мигания.
 */
export const useCatalog = (engine: LearningEngine): CatalogModel => {
  const state = ref<CatalogState>('idle');
  const entries = shallowRef<CatalogEntryDto[]>([]);
  const query = ref('');
  const kinds = shallowRef<ReadonlySet<ContributionPoint>>(new Set());
  const stale = ref(false);
  const notice = ref<string | null>(null);
  const fetchedAt = ref<string | null>(null);
  const busy = ref(false);
  const failure = ref<string | null>(null);
  let lastRequest = 0;

  const visible = computed(() =>
    filterEntries(entries.value, { query: query.value, kinds: kinds.value }),
  );
  const isFiltered = computed(() =>
    hasActiveFilters({ query: query.value, kinds: kinds.value }),
  );

  const accept = (catalog: CatalogDto) => {
    entries.value = catalog.entries;
    stale.value = catalog.stale;
    notice.value = catalog.error;
    fetchedAt.value = catalog.fetchedAt;
    failure.value = null;
    state.value = 'loaded';
  };

  const load = async (options: { refresh?: boolean } = {}) => {
    lastRequest += 1;
    const request = lastRequest;
    busy.value = true;
    if (state.value !== 'loaded') state.value = 'loading';
    try {
      const catalog = await engine.extensions.catalog(
        options.refresh === true ? { refresh: true } : undefined,
      );
      if (request === lastRequest) accept(catalog);
    } catch (caught) {
      if (request !== lastRequest) return;
      const message = toEngineError(caught).message;
      if (state.value === 'loaded') {
        notice.value = message;
        stale.value = true;
      } else {
        failure.value = message;
        state.value = 'failed';
      }
    } finally {
      if (request === lastRequest) busy.value = false;
    }
  };

  const open = async () => {
    if (state.value === 'idle') await load();
  };

  const setKind = (point: ContributionPoint, on: boolean) => {
    const next = new Set(kinds.value);
    if (on) next.add(point);
    else next.delete(point);
    kinds.value = next;
  };

  const resetFilters = () => {
    query.value = '';
    kinds.value = new Set();
  };

  const unsubscribe = engine.subscribe((event) => {
    // слушатель не вызывает команды синхронно (API §7)
    if (event.type === 'extensions-changed' && state.value === 'loaded') {
      queueMicrotask(() => void load());
    }
  });
  onScopeDispose(unsubscribe);

  return {
    state,
    entries,
    visible,
    query,
    kinds,
    isFiltered,
    stale,
    notice,
    fetchedAt,
    busy,
    failure,
    open,
    load,
    setKind,
    resetFilters,
  };
};
