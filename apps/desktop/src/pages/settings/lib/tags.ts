import { EXTENSION_TAGS } from '@dolphy-app/extension-api';
import type { ExtensionTag } from '@dolphy-app/extension-api';
import type { ExtensionContributesDto } from '@dolphy-app/engine-contract';

export type { ExtensionTag };

/** Теги словаря в порядке показа. */
export const TAGS: readonly ExtensionTag[] = EXTENSION_TAGS;

const KNOWN = new Set<string>(TAGS);

/** Теги, которые следуют из самих вкладов, если автор не указал свои. */
const POINT_TAGS: Readonly<
  Partial<Record<keyof ExtensionContributesDto, readonly ExtensionTag[]>>
> = {
  themes: ['theme', 'interface'],
  exerciseTypes: ['learning'],
  gradePolicies: ['learning'],
  events: ['learning'],
  markdownRenderers: ['content'],
  commands: ['productivity'],
  panels: ['interface'],
  widgets: ['interface'],
};

const isTag = (value: string): value is ExtensionTag => KNOWN.has(value);

/**
 * Теги для окна: явные теги автора, если они есть, иначе вычисленные по
 * вкладам. Явный список заменяет вычисленный; неизвестные строки (тег из более
 * нового индекса) игнорируются. Порядок — как в словаре, без повторов.
 */
export const effectiveTags = (
  explicit: readonly string[],
  contributes: ExtensionContributesDto,
): ExtensionTag[] => {
  const known = explicit.filter(isTag);
  const source =
    known.length > 0
      ? new Set<ExtensionTag>(known)
      : new Set<ExtensionTag>(
          (
            Object.keys(POINT_TAGS) as (keyof ExtensionContributesDto)[]
          ).flatMap((point) =>
            contributes[point].length > 0 ? (POINT_TAGS[point] ?? []) : [],
          ),
        );
  return TAGS.filter((tag) => source.has(tag));
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
