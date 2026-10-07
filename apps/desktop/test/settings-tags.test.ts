import { describe, expect, it } from 'vitest';
import { EXTENSION_TAGS } from '@dolphy-app/extension-api';
import {
  GROUPS,
  TAG_GROUPS,
  effectiveTags,
  groupsOf,
} from '@/pages/settings/lib/tags.ts';

describe('effectiveTags', () => {
  it('явные теги идут в порядке словаря без повторов', () => {
    expect(
      effectiveTags(['developer', 'theme', 'developer', 'learning']),
    ).toEqual(['learning', 'theme', 'developer']);
  });

  it('без явных тегов тегов нет: из вкладов они не выводятся', () => {
    expect(effectiveTags([])).toEqual([]);
  });

  it('неизвестные теги из более нового индекса игнорируются', () => {
    expect(effectiveTags(['theme', 'future'])).toEqual(['theme']);
    expect(effectiveTags(['future'])).toEqual([]);
  });
});

describe('группы тегов', () => {
  it('каждый тег словаря входит ровно в одну группу', () => {
    for (const tag of EXTENSION_TAGS) {
      const owners = GROUPS.filter((group) => TAG_GROUPS[group].includes(tag));
      expect(owners, tag).toHaveLength(1);
    }
    expect(GROUPS.flatMap((group) => TAG_GROUPS[group]).sort()).toEqual(
      [...EXTENSION_TAGS].sort(),
    );
  });

  it('группа расширения — пересечение с его тегами', () => {
    expect(groupsOf(['theme', 'learning'])).toEqual(['learning', 'appearance']);
    expect(groupsOf(['developer'])).toEqual(['developers']);
    expect(groupsOf([])).toEqual([]);
  });
});
