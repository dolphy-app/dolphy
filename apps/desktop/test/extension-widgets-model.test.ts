import { shallowRef } from 'vue';
import { describe, expect, it } from 'vitest';
import type {
  CommandContributionDto,
  WidgetContributionDto,
} from '@dolphy-app/engine-contract';
import { NO_CONTRIBUTIONS } from '@/shared/api/engine/contributions.ts';
import { createExtensionWhen } from '@/shared/lib/extension-when.ts';
import {
  widgetKeyOf,
  widgetsOf,
} from '@/widgets/extension-widgets/model/widgets.ts';

const widget = (
  id: string,
  extensionId = 'acme.cards',
  override: Partial<WidgetContributionDto> = {},
): WidgetContributionDto => ({
  id,
  extensionId,
  title: id,
  slot: 'dailyPlan',
  minHeight: 80,
  maxHeight: 320,
  when: null,
  rendererUrl: `dolphy-ext://${extensionId}/widget.mjs`,
  isolated: true,
  origin: 'user',
  revision: 'r1',
  ...override,
});

const command = (
  id: string,
  extensionId: string,
  palette = true,
): CommandContributionDto => ({
  id,
  extensionId,
  title: id,
  description: null,
  category: null,
  keybinding: null,
  keybindings: [],
  when: null,
  palette,
  icon: 'puzzle',
});

const ALWAYS = createExtensionWhen({
  route: () => 'daily-plan',
  courseActive: () => false,
  locale: () => 'en',
  dark: () => false,
});

describe('widgetsOf', () => {
  it('без виджетов блока нет', () => {
    expect(widgetsOf(NO_CONTRIBUTIONS, 'dailyPlan', ALWAYS)).toEqual([]);
  });

  it('берёт виджеты места в порядке вкладов; команды — только своего расширения, в том числе palette:false', () => {
    const resolved = widgetsOf(
      {
        ...NO_CONTRIBUTIONS,
        widgets: [
          widget('acme.cards.b'),
          widget('other.card', 'other'),
          widget('acme.cards.a'),
        ],
        commands: [
          command('acme.cards.refresh', 'acme.cards'),
          command('acme.cards.hidden', 'acme.cards', false),
          command('other.steal', 'other'),
        ],
      },
      'dailyPlan',
      ALWAYS,
    );
    expect(resolved.map(({ widget: { id } }) => id)).toEqual([
      'acme.cards.b',
      'other.card',
      'acme.cards.a',
    ]);
    expect([...resolved[0]!.commands].sort()).toEqual([
      'acme.cards.hidden',
      'acme.cards.refresh',
    ]);
    expect([...resolved[1]!.commands]).toEqual(['other.steal']);
  });

  it('ключ рамки включает ревизию: обновление расширения пересоздаёт рамку', () => {
    const before = widget('acme.cards.a', 'acme.cards', { revision: 'r1' });
    const after = widget('acme.cards.a', 'acme.cards', { revision: 'r2' });
    expect(widgetKeyOf(before)).not.toBe(widgetKeyOf(after));
    expect(widgetKeyOf(before)).toBe(widgetKeyOf({ ...before }));
    expect(
      widgetsOf({ ...NO_CONTRIBUTIONS, widgets: [after] }, 'dailyPlan', ALWAYS)[0]
        ?.key,
    ).toBe(widgetKeyOf(after));
  });

  it('виджет с ложным when не попадает в набор; блок исчезает, пока все условия ложны, и возвращается без перезагрузки', () => {
    const route = shallowRef('daily-plan');
    const when = createExtensionWhen({
      route: () => route.value,
      courseActive: () => false,
      locale: () => 'en',
      dark: () => false,
    });
    const contributions = {
      ...NO_CONTRIBUTIONS,
      widgets: [
        widget('acme.cards.plain'),
        widget('acme.cards.gated', 'acme.cards', {
          when: "route == 'courses'",
        }),
      ],
    };
    const ids = () =>
      widgetsOf(contributions, 'dailyPlan', when).map(
        ({ widget: { id } }) => id,
      );

    expect(ids()).toEqual(['acme.cards.plain']);
    route.value = 'courses';
    expect(ids()).toEqual(['acme.cards.plain', 'acme.cards.gated']);
    expect(
      widgetsOf(
        { ...contributions, widgets: [contributions.widgets[1]!] },
        'dailyPlan',
        createExtensionWhen({
          route: () => 'daily-plan',
          courseActive: () => false,
          locale: () => 'en',
          dark: () => false,
        }),
      ),
    ).toEqual([]);
  });
});
