import { rowsOfCatalog, rowsOfInstalled } from './dependencies.ts';
import type { DependencyRow } from './dependencies.ts';
import { isEffectiveExtensionState } from '@dolphy-app/engine-contract';
import type {
  CatalogEntryDto,
  CatalogListedVersionDto,
  ContributionTitlesDto,
  DeprecationDto,
  ExtensionContributesDto,
  ExtensionInfoDto,
  ExtensionMessagesDto,
  ExtensionUpdateDto,
} from '@dolphy-app/engine-contract';
import { entryAction, entryTags } from './catalog.ts';
import type { EntryAction } from './catalog.ts';
import { effectiveTags } from './tags.ts';
import type { ExtensionTag } from './tags.ts';

/** Логин GitHub: буквы, цифры и дефисы, до 39 знаков, не с дефиса. */
const GITHUB_LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;

/** Профиль GitHub автора; `null`, если «автор» не похож на логин (произвольная строка манифеста). */
export const authorProfileUrl = (author: string | null): string | null =>
  author !== null && GITHUB_LOGIN.test(author)
    ? `https://github.com/${author}`
    : null;

/** Ссылка из записи каталога, которую окно может открыть во внешнем браузере: только `https:`. */
export const externalUrl = (url: string | null | undefined): string | null =>
  typeof url === 'string' && url.startsWith('https://') ? url : null;

/** Строка списка версий страницы. */
export interface VersionRow {
  version: string;
  publishedAt: string;
  size: number;
  /** `null` — версию можно установить; иначе причина на английском. */
  incompatible: CatalogListedVersionDto['incompatible'];
  /** Версия установлена из этого каталога. */
  installed: boolean;
  /** Описание страницы относится к этой версии. */
  selected: boolean;
  hasChangelog: boolean;
}

/** Что показывает страница расширения: установленное, запись каталога или и то и другое (сопоставление по id). */
export interface ExtensionDetails {
  id: string;
  /** Установленное расширение (`extensions.list`); `null` — не установлено. */
  info: ExtensionInfoDto | null;
  /** Запись каталога; `null` — расширения нет в каталоге или каталог недоступен. */
  entry: CatalogEntryDto | null;
  /** Чьи вклады, теги и название показаны: установленного, если оно есть. */
  shown: 'installed' | 'catalog';
  icon: string | null;
  author: string | null;
  authorUrl: string | null;
  tags: ExtensionTag[];
  contributes: ExtensionContributesDto;
  titles: ContributionTitlesDto;
  /** Таблицы переводов установленного; у записи каталога `undefined` (там английский текст). */
  messages: ExtensionMessagesDto | undefined;
  /** Разрешения показанной версии; `null` — не показываются. */
  permissions: string[] | null;
  /** «Исходники» из записи каталога; `null` — нет ссылки. */
  sourceUrl: string | null;
  /** Версия, установленная из каталога; `null` — не установлена или установлена не оттуда. */
  installedVersion: string | null;
  deprecation: DeprecationDto | null;
  /** Версии записи каталога (до 5, новейшие первыми); пусто без записи. */
  versions: VersionRow[];
  /** Действие карточки; `null` — действия каталога нет (нет записи). */
  action: EntryAction | null;
  /** Установленное можно удалить. */
  removable: boolean;
  /** Зависимости показанной версии: установленной — с состоянием из диагностик, версии каталога — с отметкой «установлено / нет». */
  dependencies: DependencyRow[];
}

const isActive = (info: ExtensionInfoDto) =>
  isEffectiveExtensionState(info.state);

const shownTags = (
  info: ExtensionInfoDto | null,
  entry: CatalogEntryDto | null,
): ExtensionTag[] => {
  if (info !== null) return effectiveTags(info.tags, info.contributes);
  return entry === null ? [] : entryTags(entry);
};

/** Разрешения показанной версии: установленной (если она действует) или новейшей из каталога. */
const shownPermissions = (
  info: ExtensionInfoDto | null,
  entry: CatalogEntryDto | null,
): string[] | null => {
  if (info === null) return entry?.latest?.permissions ?? null;
  return isActive(info) ? info.permissions : null;
};

/** Предупреждение страницы: установленной версии, а без установленной — показанной версии каталога. */
const deprecationOf = (
  info: ExtensionInfoDto | null,
  entry: CatalogEntryDto | null,
): DeprecationDto | null => {
  const fromEntry =
    entry !== null && !entry.elsewhere ? entry.deprecated : null;
  if (info === null) return entry?.deprecated ?? null;
  return info.deprecated ?? fromEntry;
};

const actionOf = (
  entry: CatalogEntryDto | null,
  update: ExtensionUpdateDto | null,
): EntryAction | null => {
  if (entry !== null) return entryAction(entry);
  if (update === null) return null;
  return {
    kind: 'update',
    installed: update.installed,
    version: update.available,
  };
};

/**
 * Модель страницы расширения по установленному и записи каталога. `selected` —
 * версия, чьё описание показано; `null` — пока неизвестна. Нет ни того ни другого —
 * `null` (расширения нет).
 */
export const describeDetails = (
  id: string,
  info: ExtensionInfoDto | null,
  entry: CatalogEntryDto | null,
  update: ExtensionUpdateDto | null,
  selected: string | null,
  /** Установленные расширения для отметок зависимостей каталога; `null` — список не получен. */
  installed: readonly ExtensionInfoDto[] | null = null,
): ExtensionDetails | null => {
  if (info === null && entry === null) return null;
  const contributes = info?.contributes ?? entry?.contributes;
  if (contributes === undefined) return null;
  const installedVersion =
    entry?.installedVersion ?? info?.installed?.version ?? null;
  const author = info?.author ?? entry?.author ?? null;
  const permissions = shownPermissions(info, entry);
  return {
    id,
    info,
    entry,
    shown: info === null ? 'catalog' : 'installed',
    icon: info?.icon ?? entry?.icon ?? null,
    author,
    authorUrl: authorProfileUrl(author),
    tags: shownTags(info, entry),
    contributes,
    titles: info?.titles ?? entry?.titles ?? {},
    messages: info?.messages,
    permissions,
    sourceUrl: externalUrl(entry?.source),
    installedVersion,
    deprecation: deprecationOf(info, entry),
    versions: (entry?.versions ?? []).map((version) => ({
      version: version.version,
      publishedAt: version.publishedAt,
      size: version.size,
      incompatible: version.incompatible,
      installed: version.version === installedVersion,
      selected: version.version === selected,
      hasChangelog: version.hasChangelog,
    })),
    action: actionOf(entry, update),
    removable: info?.removable === true,
    dependencies:
      info === null
        ? rowsOfCatalog(entry?.latest?.dependencies ?? [], installed)
        : rowsOfInstalled(info),
  };
};
