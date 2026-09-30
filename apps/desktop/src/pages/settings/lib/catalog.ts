import type {
  CatalogEntryDto,
  CatalogIncompatibleDto,
  CatalogVersionDto,
  ExtensionContributesDto,
  ExtensionInfoDto,
  ExtensionUpdateDto,
} from '@dolphy-app/engine-contract';

export type ContributionPoint = keyof ExtensionContributesDto;

/** Точки вклада в порядке показа; то же перечисление — фильтр каталога. */
export const CONTRIBUTION_POINTS: readonly ContributionPoint[] = [
  'exerciseTypes',
  'themes',
  'markdownRenderers',
  'gradePolicies',
];

export interface CatalogFilters {
  query: string;
  kinds: ReadonlySet<ContributionPoint>;
}

const normalize = (text: string) => text.trim().toLowerCase();

/** Расширения, недоступные на этой платформе, в каталоге не показываются. */
export const isListed = (entry: CatalogEntryDto): boolean =>
  entry.incompatible?.reason !== 'platform';

/** Название, id, описание или автор содержат запрос без учёта регистра. */
export const matchesQuery = (
  entry: CatalogEntryDto,
  query: string,
): boolean => {
  const needle = normalize(query);
  if (needle === '') return true;
  const fields = [entry.name, entry.id, entry.description, entry.author];
  return fields.some((field) => field.toLowerCase().includes(needle));
};

/** Пустой набор — без фильтра; иначе достаточно вклада в любую выбранную точку. */
export const matchesKinds = (
  entry: CatalogEntryDto,
  kinds: ReadonlySet<ContributionPoint>,
): boolean =>
  kinds.size === 0 ||
  CONTRIBUTION_POINTS.some(
    (point) => kinds.has(point) && entry.contributes[point].length > 0,
  );

export const filterEntries = (
  entries: readonly CatalogEntryDto[],
  filters: CatalogFilters,
): CatalogEntryDto[] =>
  entries.filter(
    (entry) =>
      isListed(entry) &&
      matchesQuery(entry, filters.query) &&
      matchesKinds(entry, filters.kinds),
  );

export const hasActiveFilters = (filters: CatalogFilters): boolean =>
  normalize(filters.query) !== '' || filters.kinds.size > 0;

export type EntryAction =
  | { kind: 'install'; version: CatalogVersionDto }
  | { kind: 'installed'; version: string }
  | { kind: 'update'; installed: string; version: CatalogVersionDto }
  | {
      kind: 'incompatible';
      reason: CatalogIncompatibleDto['reason'];
      detail: string;
      fallback: CatalogVersionDto | null;
    };

/** Состояние карточки → действие: что показать на кнопке и какую версию ставить. */
export const entryAction = (entry: CatalogEntryDto): EntryAction => {
  const { status, latest, incompatible, installedVersion } = entry;
  if (status === 'installed') {
    return { kind: 'installed', version: installedVersion ?? '' };
  }
  if (status === 'incompatible' || latest === null) {
    return {
      kind: 'incompatible',
      reason: incompatible?.reason ?? 'api',
      detail: incompatible?.detail ?? '',
      fallback: incompatible?.fallback ?? null,
    };
  }
  if (status === 'update') {
    return {
      kind: 'update',
      installed: installedVersion ?? '',
      version: latest,
    };
  }
  return { kind: 'install', version: latest };
};

/** Что показывает диалог перед установкой или обновлением. */
export interface InstallTarget {
  id: string;
  name: string;
  author: string | null;
  /** Версия, которая будет установлена. */
  version: string;
  /** Версия, установленная из каталога сейчас; `null` — новая установка. */
  installedVersion: string | null;
  permissions: string[];
  contributes: ExtensionContributesDto;
  platforms: string[];
  sizeBytes: number;
}

export const targetFromEntry = (
  entry: CatalogEntryDto,
  version: CatalogVersionDto,
): InstallTarget => ({
  id: entry.id,
  name: entry.name,
  author: entry.author,
  version: version.version,
  installedVersion: entry.installedVersion,
  permissions: [...version.permissions],
  contributes: entry.contributes,
  platforms: [...entry.platforms],
  sizeBytes: version.size,
});

const NO_CONTRIBUTES: ExtensionContributesDto = {
  exerciseTypes: [],
  themes: [],
  markdownRenderers: [],
  gradePolicies: [],
};

/**
 * Обновление установленного расширения. Вклады и платформы берутся из записи
 * каталога, если она есть; иначе — из установленной версии.
 */
export const targetFromUpdate = (
  update: ExtensionUpdateDto,
  info: ExtensionInfoDto | undefined,
  entry: CatalogEntryDto | undefined,
): InstallTarget => ({
  id: update.id,
  name: update.name,
  author: entry?.author ?? info?.author ?? null,
  version: update.available.version,
  installedVersion: update.installed,
  permissions: [...update.available.permissions],
  contributes: entry?.contributes ?? info?.contributes ?? NO_CONTRIBUTES,
  platforms: entry === undefined ? [] : [...entry.platforms],
  sizeBytes: update.available.size,
});

/** Название для показа: из манифеста, иначе id. */
export const displayName = (info: {
  id: string;
  name: string | null;
}): string => info.name ?? info.id;
