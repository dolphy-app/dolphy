import { describe, expect, it } from 'vitest';
import type { ExtensionSettingDefDto } from '@dolphy-app/engine-contract';
import {
  buildSettingsSections,
  isSettingVisible,
} from '@/pages/settings/model/extension-settings-form.ts';

const def = (
  id: string,
  patch: Partial<ExtensionSettingDefDto> = {},
): ExtensionSettingDefDto =>
  ({
    id: `acme.${id}`,
    extensionId: 'acme',
    type: 'boolean',
    label: id,
    description: null,
    group: null,
    order: 0,
    visibleWhen: null,
    default: false,
    ...patch,
  }) as ExtensionSettingDefDto;

const ids = (sections: ReturnType<typeof buildSettingsSections>) =>
  sections.map(({ title, fields }) => [
    title,
    fields.map(({ id }) => id.replace('acme.', '')),
  ]);

describe('buildSettingsSections', () => {
  it('без group, order и условий — один раздел без заголовка в порядке объявления', () => {
    expect(
      ids(buildSettingsSections([def('a'), def('b'), def('c')], {})),
    ).toEqual([[null, ['a', 'b', 'c']]]);
  });

  it('сортирует по order (нет — 0), затем по порядку объявления', () => {
    const sections = buildSettingsSections(
      [
        def('a', { order: 5 }),
        def('b'),
        def('c', { order: 5 }),
        def('d', { order: 1 }),
        def('e', { order: 0 }),
      ],
      {},
    );
    expect(ids(sections)).toEqual([[null, ['b', 'e', 'd', 'a', 'c']]]);
  });

  it('настройки без group — первым разделом без заголовка; разделы в порядке первого вхождения', () => {
    const sections = buildSettingsSections(
      [
        def('a', { group: 'Second' }),
        def('b', { group: 'First', order: 0 }),
        def('c'),
        def('d', { group: 'Second' }),
        def('e', { group: 'Late', order: 9 }),
        def('f', { group: 'First', order: 2 }),
      ],
      {},
    );
    expect(ids(sections)).toEqual([
      [null, ['c']],
      ['Second', ['a', 'd']],
      ['First', ['b', 'f']],
      ['Late', ['e']],
    ]);
  });

  it('порядок разделов определяет order первой настройки раздела', () => {
    const sections = buildSettingsSections(
      [def('a', { group: 'Late', order: 9 }), def('b', { group: 'Early' })],
      {},
    );
    expect(ids(sections)).toEqual([
      ['Early', ['b']],
      ['Late', ['a']],
    ]);
  });

  it('скрытое поле не показано, пока значение цели не равно equals; раздел без видимых полей пропадает', () => {
    const defs = [
      def('on'),
      def('detail', {
        group: 'More',
        visibleWhen: { setting: 'acme.on', equals: true },
      }),
    ];
    expect(ids(buildSettingsSections(defs, { 'acme.on': false }))).toEqual([
      [null, ['on']],
    ]);
    expect(ids(buildSettingsSections(defs, { 'acme.on': true }))).toEqual([
      [null, ['on']],
      ['More', ['detail']],
    ]);
  });
});

describe('isSettingVisible', () => {
  const mode = def('mode', {
    type: 'enum',
    default: 'a',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ],
  } as Partial<ExtensionSettingDefDto>);
  const gated = (equals: string | number | boolean, setting = 'acme.mode') =>
    def('x', { visibleWhen: { setting, equals } });

  it('без значения берётся default цели', () => {
    expect(isSettingVisible(gated('a'), [mode, gated('a')], {})).toBe(true);
    expect(isSettingVisible(gated('b'), [mode, gated('b')], {})).toBe(false);
  });

  it('значение сравнивается строго: 1 не равно "1", число — числу', () => {
    const count = def('count', {
      type: 'number',
      default: 1,
    } as Partial<ExtensionSettingDefDto>);
    const x = gated(1, 'acme.count');
    expect(isSettingVisible(x, [count, x], { 'acme.count': 1 })).toBe(true);
    expect(isSettingVisible(x, [count, x], { 'acme.count': 2 })).toBe(false);
    const y = gated('1', 'acme.count');
    expect(isSettingVisible(y, [count, y], { 'acme.count': 1 })).toBe(false);
  });

  it('цель, которой больше нет среди определений, поле скрывает', () => {
    const x = gated('a', 'acme.gone');
    expect(isSettingVisible(x, [x], {})).toBe(false);
  });
});
