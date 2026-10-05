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
  'acme.typed.echo': defineAnswerView(() => ({ update: () => undefined })),
} satisfies ExtensionViews;

export const panels = {
  'acme.typed.main': defineExtensionPanel({
    mount(container, ctx) {
      container.textContent = ctx.panelId;
      void ctx.call('acme.typed.ping');
    },
  }),
} satisfies ExtensionPanels;

export const widgets = {
  'acme.typed.card': defineExtensionWidget({
    mount(container, ctx) {
      container.textContent = `${ctx.widgetId} ${ctx.context.courseId ?? ''}`;
      ctx.onContextChange(({ courseId }) => void courseId);
      void ctx.call('acme.typed.ping');
    },
  }),
} satisfies ExtensionWidgets;

export const markdown = {
  'typed-echo': defineMarkdownRenderer((source, container) => {
    container.textContent = source;
  }),
} satisfies ExtensionMarkdown;
