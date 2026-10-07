import { EXTENSION_TAGS } from '@dolphy-app/extension-api';
import type { ExtensionTag } from '@dolphy-app/extension-api';

export type { ExtensionTag };

/** Теги словаря в порядке показа. */
export const TAGS: readonly ExtensionTag[] = EXTENSION_TAGS;

const KNOWN = new Set<string>(TAGS);

const isTag = (value: string): value is ExtensionTag => KNOWN.has(value);

/**
 * Теги для окна: известные явные теги автора в порядке словаря, без повторов.
 * Неизвестные строки (тег из более нового индекса) игнорируются.
 */
export const effectiveTags = (explicit: readonly string[]): ExtensionTag[] => {
  const known = new Set(explicit.filter(isTag));
  return TAGS.filter((tag) => known.has(tag));
};

export type TagGroup = 'learning' | 'appearance' | 'developers';

/** Быстрые группы фильтра в порядке показа; каждый тег словаря входит ровно в одну. */
export const TAG_GROUPS: Readonly<Record<TagGroup, readonly ExtensionTag[]>> = {
  learning: ['learning', 'language', 'content'],
  appearance: ['theme', 'interface', 'productivity'],
  developers: ['developer'],
};

export const GROUPS = Object.keys(TAG_GROUPS) as TagGroup[];

/** Группы, в которые попадает набор тегов (пересечение с группой непусто). */
export const groupsOf = (tags: readonly ExtensionTag[]): TagGroup[] =>
  GROUPS.filter((group) => TAG_GROUPS[group].some((tag) => tags.includes(tag)));
