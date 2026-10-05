import { describe, expect, it } from 'vitest';
import { EXTENSION_TAGS } from '@dolphy-app/extension-api';
import {
  GROUPS,
  TAG_GROUPS,
  effectiveTags,
  groupsOf,
} from '@/pages/settings/lib/tags.ts';
import type { ContributionPoint } from '@/pages/settings/lib/catalog.ts';
import { NO_CONTRIBUTES } from './support/extensions-fakes.ts';

const only = (point: ContributionPoint) => ({
  ...NO_CONTRIBUTES,
  [point]: ['x'],
});

describe('effectiveTags', () => {
  it.each([
    ['themes', ['theme', 'interface']],
    ['exerciseTypes', ['learning']],
    ['gradePolicies', ['learning']],
    ['events', ['learning']],
    ['markdownRenderers', ['content']],
    ['commands', ['productivity']],
    ['panels', ['interface']],
    ['widgets', ['interface']],
    ['settings', []],
  ] as const)('без явных тегов %s даёт %j', (point, expected) => {
    expect(effectiveTags([], only(point))).toEqual(expected);
  });

  it('вклады нескольких точек объединяются без повторов в порядке словаря', () => {
    expect(
      effectiveTags([], {
        ...NO_CONTRIBUTES,
        panels: ['p'],
        themes: ['t'],
        exerciseTypes: ['e'],
      }),
    ).toEqual(['learning', 'theme', 'interface']);
  });

  it('явные теги заменяют вычисленные, а не дополняют', () => {
    expect(effectiveTags(['developer'], only('themes'))).toEqual(['developer']);
  });

  it('language и developer вычисляются только из явных тегов', () => {
    const all = effectiveTags([], {
      exerciseTypes: ['a'],
      themes: ['a'],
      markdownRenderers: ['a'],
      gradePolicies: ['a'],
      settings: ['a'],
      events: ['a'],
      commands: ['a'],
      panels: ['a'],
      widgets: ['a'],
      importers: [],
      exporters: [],
    });
    expect(all).not.toContain('language');
    expect(all).not.toContain('developer');
  });

  it('неизвестные теги из более нового индекса игнорируются; если известных нет — вычисляются', () => {
    expect(effectiveTags(['theme', 'future'], only('commands'))).toEqual([
      'theme',
    ]);
    expect(effectiveTags(['future'], only('commands'))).toEqual([
      'productivity',
    ]);
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
