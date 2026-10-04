import { computed, onScopeDispose, ref, shallowRef } from 'vue';
import type { ComputedRef, Ref, ShallowRef } from 'vue';
import type {
  CatalogDto,
  CatalogEntryDto,
  LearningEngine,
} from '@dolphy-app/engine-contract';
import { toEngineError } from '@/entities/repository';
import {
  facetCounts,
  filterEntries,
  hasActiveFilters,
} from '../lib/catalog.ts';
import type { ContributionPoint, FacetCounts } from '../lib/catalog.ts';
import type { ExtensionTag, TagGroup } from '../lib/tags.ts';

/** `idle` — вкладку ещё не открывали, индекс не запрашивался. */
export type CatalogState = 'idle' | 'loading' | 'loaded' | 'failed';

export interface CatalogModel {
  state: Ref<CatalogState>;
  entries: ShallowRef<CatalogEntryDto[]>;
  /** Записи под поиском и фильтрами, в порядке движка. */
  visible: ComputedRef<CatalogEntryDto[]>;
  query: Ref<string>;
  groups: ShallowRef<ReadonlySet<TagGroup>>;
  tags: ShallowRef<ReadonlySet<ExtensionTag>>;
  kinds: ShallowRef<ReadonlySet<ContributionPoint>>;
  /** Числа в чипах: под поиском, без учёта выбранных фильтров. */
  counts: ComputedRef<FacetCounts>;
  /** Блок «Ещё фильтры» раскрыт (кнопкой или выбором тега/вида) и остаётся так после снятия выбора. */
  moreOpen: Ref<boolean>;
  /** Выбран тег или вид вклада: блок «Ещё фильтры» раскрыт и не сворачивается. */
  moreActive: ComputedRef<boolean>;
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
  setGroup(group: TagGroup, on: boolean): void;
  setTag(tag: ExtensionTag, on: boolean): void;
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
  const groups = shallowRef<ReadonlySet<TagGroup>>(new Set());
  const tags = shallowRef<ReadonlySet<ExtensionTag>>(new Set());
  const kinds = shallowRef<ReadonlySet<ContributionPoint>>(new Set());
  const moreOpen = ref(false);
  const stale = ref(false);
  const notice = ref<string | null>(null);
  const fetchedAt = ref<string | null>(null);
  const busy = ref(false);
  const failure = ref<string | null>(null);
  let lastRequest = 0;

  const filters = computed(() => ({
    query: query.value,
    groups: groups.value,
    tags: tags.value,
    kinds: kinds.value,
  }));
  const visible = computed(() => filterEntries(entries.value, filters.value));
  const isFiltered = computed(() => hasActiveFilters(filters.value));
  const counts = computed(() => facetCounts(entries.value, query.value));
  const moreActive = computed(
    () => tags.value.size > 0 || kinds.value.size > 0,
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

  const toggled = <T>(set: ReadonlySet<T>, value: T, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  };
  const setGroup = (group: TagGroup, on: boolean) => {
    groups.value = toggled(groups.value, group, on);
  };
  // выбор тега или вида раскрывает блок насовсем: после снятия чип под курсором не исчезает
  const setTag = (tag: ExtensionTag, on: boolean) => {
    if (on) moreOpen.value = true;
    tags.value = toggled(tags.value, tag, on);
  };
  const setKind = (point: ContributionPoint, on: boolean) => {
    if (on) moreOpen.value = true;
    kinds.value = toggled(kinds.value, point, on);
  };

  const resetFilters = () => {
    query.value = '';
    groups.value = new Set();
    tags.value = new Set();
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
    groups,
    tags,
    kinds,
    counts,
    moreOpen,
    moreActive,
    isFiltered,
    stale,
    notice,
    fetchedAt,
    busy,
    failure,
    open,
    load,
    setGroup,
    setTag,
    setKind,
    resetFilters,
  };
};
