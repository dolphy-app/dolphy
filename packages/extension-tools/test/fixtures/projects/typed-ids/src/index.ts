import {
  defineAnswerView,
  defineExerciseType,
  defineExtension,
  defineExtensionPanel,
  defineExtensionWidget,
  defineMarkdownRenderer,
  inActivate,
  notify,
  openPanel,
} from '@dolphy-app/extension-sdk';
import { usePanel, useWidget } from '@dolphy-app/extension-sdk/client';
import { defineComponent, h } from 'vue';
import type {
  ExtensionMarkdown,
  ExtensionPanels,
  ExtensionViews,
  ExtensionWidgets,
} from '@dolphy-app/extension-sdk';

export const host = defineExtension({
  exerciseTypes: {
    'acme.typed.echo': defineExerciseType({
      project: () => ({}),
      grade: () => ({ outcome: 'passed' }),
    }),
  },
  gradePolicies: { 'acme.typed.strict': () => 5 },
  events: {
    'attempt.closed': ({ grade }) => void (grade > 3),
  },
  commands: {
    'acme.typed.open': () => openPanel('acme.typed.main'),
    'acme.typed.ping': inActivate,
  },
  activate(ctx) {
    const on: boolean = ctx.settings.get('acme.typed.on');
    const name: string = ctx.settings.get('acme.typed.name');
    const goal: number = ctx.settings.get('acme.typed.goal');
    const mode: 'fast' | 'slow' = ctx.settings.get('acme.typed.mode');
    ctx.settings.onDidChange((change) => {
      if (change.id === 'acme.typed.goal') void (change.value + 1);
      if (change.id === 'acme.typed.mode') void (change.value === 'slow');
    });
    ctx.commands.register('acme.typed.ping', () => notify(`${name}${goal}`));
    void [on, mode];
  },
});

export const views = {
  'acme.typed.echo': defineAnswerView(
    defineComponent({ render: () => h('input') }),
  ),
} satisfies ExtensionViews;

export const panels = {
  'acme.typed.main': defineExtensionPanel(
    defineComponent({
      setup() {
        const panel = usePanel();
        void panel.call('acme.typed.ping');
        return () => h('p', panel.panelId);
      },
    }),
  ),
} satisfies ExtensionPanels;

export const widgets = {
  'acme.typed.card': defineExtensionWidget(
    defineComponent({
      setup() {
        const widget = useWidget();
        void widget.call('acme.typed.ping');
        return () => h('p', `${widget.widgetId} ${widget.context.courseId}`);
      },
    }),
  ),
} satisfies ExtensionWidgets;

export const markdown = {
  'typed-echo': defineMarkdownRenderer(
    defineComponent({
      props: { source: { type: String, required: true } },
      setup: (props) => () => h('pre', props.source),
    }),
  ),
} satisfies ExtensionMarkdown;
