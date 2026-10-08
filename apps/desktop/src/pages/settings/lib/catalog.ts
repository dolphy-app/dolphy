import type { ExtensionDependencyDto } from '@dolphy-app/engine-contract';
import type {
  CatalogEntryDto,
  CatalogIncompatibleDto,
  CatalogVersionDto,
  DeprecationDto,
  ExtensionInfoDto,
  ExtensionUpdateDto,
  LocalizedTextDto,
} from '@dolphy-app/engine-contract';
import { localizedTexts } from '@dolphy-app/extension-api';
import { satisfiesRange } from '@dolphy-app/extension-catalog/semver';
import { GROUPS, TAGS, effectiveTags, groupsOf } from './tags.ts';
import type { ExtensionTag, TagGroup } from './tags.ts';

/** Имя события обучения → ключ сообщения `settings.extensions.events.*` (точка в ключе vue-i18n — путь). */
export const EVENT_MESSAGE_KEYS: Readonly<Record<string, string>> = {
  'session.started': 'sessionStarted',
  'session.finished': 'sessionFinished',
  'attempt.closed': 'attemptClosed',
};

/** Фильтры каталога. Внутри ряда (группы, теги) — «или», между рядами и с поиском — «и». */
export interface CatalogFilters {
  query: string;
  groups: ReadonlySet<TagGroup>;
  tags: ReadonlySet<ExtensionTag>;
}

/** Эффективные теги записи каталога: известные явные теги показанной версии. */
export const entryTags = (entry: CatalogEntryDto): ExtensionTag[] =>
  effectiveTags(entry.tags);

const normalize = (text: string) => text.trim().toLowerCase();

/** Расширения, недоступные на этой платформе, в каталоге не показываются. */
export const isListed = (entry: CatalogEntryDto): boolean =>
  entry.incompatible?.reason !== 'platform';

/** Название, id, описание (на любом языке) или автор содержат запрос без учёта регистра. */
export const matchesQuery = (
  entry: CatalogEntryDto,
  query: string,
): boolean => {
  const needle = normalize(query);
  if (needle === '') return true;
  const fields = [
    ...localizedTexts(entry.name),
    entry.id,
    ...localizedTexts(entry.description),
    entry.author,
  ];
  return fields.some((field) => field.toLowerCase().includes(needle));
};

/** Пустой набор — без фильтра; иначе запись входит в любую выбранную группу. */
export const matchesGroups = (
  entry: CatalogEntryDto,
  groups: ReadonlySet<TagGroup>,
): boolean =>
  groups.size === 0 ||
  groupsOf(entryTags(entry)).some((group) => groups.has(group));

/** Пустой набор — без фильтра; иначе у записи есть любой выбранный тег. */
export const matchesTags = (
  entry: CatalogEntryDto,
  tags: ReadonlySet<ExtensionTag>,
): boolean => tags.size === 0 || entryTags(entry).some((tag) => tags.has(tag));

export interface FacetCounts {
  groups: Record<TagGroup, number>;
  tags: Record<ExtensionTag, number>;
}

/**
 * Сколько расширений в каждой группе и у каждого тега. Считается по
 * показываемым записям под поиском, но без выбранных фильтров: числа не
 * прыгают при выборе чипа.
 */
export const facetCounts = (
  entries: readonly CatalogEntryDto[],
  query: string,
): FacetCounts => {
  const groups = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<
    TagGroup,
    number
  >;
  const tags = Object.fromEntries(TAGS.map((tag) => [tag, 0])) as Record<
    ExtensionTag,
    number
  >;
  for (const entry of entries) {
    if (!isListed(entry) || !matchesQuery(entry, query)) continue;
    const own = entryTags(entry);
    for (const tag of own) tags[tag] += 1;
    for (const group of groupsOf(own)) groups[group] += 1;
  }
  return { groups, tags };
};

export const filterEntries = (
  entries: readonly CatalogEntryDto[],
  filters: CatalogFilters,
): CatalogEntryDto[] =>
  entries.filter(
    (entry) =>
      isListed(entry) &&
      matchesGroups(entry, filters.groups) &&
      matchesTags(entry, filters.tags) &&
      matchesQuery(entry, filters.query),
  );

export const hasActiveFilters = (filters: CatalogFilters): boolean =>
  normalize(filters.query) !== '' ||
  filters.groups.size > 0 ||
  filters.tags.size > 0;

export type EntryAction =
  | { kind: 'install'; version: CatalogVersionDto }
  /** С этим id уже есть расширение не из этого каталога: кнопка неактивна. */
  | { kind: 'elsewhere' }
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
  if (entry.elsewhere) return { kind: 'elsewhere' };
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

/**
 * Пометка «устарело», действующая для `version`: диапазон `versions` проверяется
 * по номеру, `null` в диапазоне — все версии. Запись каталога несёт пометку,
 * действующую для показанной версии, а ставить можно и другую (совместимую
 * более старую), поэтому диалог проверяет ту, что будет установлена.
 */
export const deprecationFor = (
  deprecation: DeprecationDto | null,
  version: string,
): DeprecationDto | null => {
  if (deprecation === null || deprecation.versions === null) return deprecation;
  try {
    return satisfiesRange(version, deprecation.versions) ? deprecation : null;
  } catch {
    // нечитаемый диапазон или версия: предупреждение лучше умолчания
    return deprecation;
  }
};

/** Что показывает диалог перед установкой или обновлением. */
export interface InstallTarget {
  id: string;
  /** Название на языках записи; язык выбирает окно (`useExtensionText().of`). */
  name: LocalizedTextDto;
  author: string | null;
  /** Версия, которая будет установлена. */
  version: string;
  /** Версия, установленная из каталога сейчас; `null` — новая установка. */
  installedVersion: string | null;
  /** Зависимости устанавливаемой версии; установка их не ставит и не блокируется. */
  dependencies: ExtensionDependencyDto[];
  /** Эффективные теги: известные явные теги расширения. */
  tags: ExtensionTag[];
  platforms: string[];
  sizeBytes: number;
  /** Значок как `data:`-URI; `null` — без значка. */
  icon: string | null;
  /** Предупреждение об устаревании, действующее для устанавливаемой версии; `null` — нет. */
  deprecated: DeprecationDto | null;
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
  dependencies: version.dependencies.map((dependency) => ({ ...dependency })),
  tags: entryTags(entry),
  platforms: [...entry.platforms],
  sizeBytes: version.size,
  icon: entry.icon,
  deprecated: deprecationFor(entry.deprecated, version.version),
});

/**
 * Обновление установленного расширения. Платформы берутся из записи
 * каталога, если она есть.
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
  dependencies: update.available.dependencies.map((dependency) => ({
    ...dependency,
  })),
  tags: effectiveTags(entry?.tags ?? info?.tags ?? []),
  platforms: entry === undefined ? [] : [...entry.platforms],
  sizeBytes: update.available.size,
  icon: entry?.icon ?? info?.icon ?? null,
  // обновляемся на версию каталога: предупреждение записи, а не установленной версии
  deprecated: deprecationFor(
    entry?.deprecated ?? null,
    update.available.version,
  ),
});
