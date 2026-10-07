import { spawn } from 'node:child_process';
import {
  defineAnswerView,
  defineExerciseType,
  defineExtension,
  defineExtensionPanel,
  defineExtensionWidget,
  defineMarkdownRenderer,
} from '@dolphy-app/extension-sdk';
import { defineComponent, h } from 'vue';
import { shout } from './shout.ts';

export const host = defineExtension({
  exerciseTypes: {
    'acme.surfaces.one': defineExerciseType({
      project: () => 'HOST_ONLY_MARKER',
      grade: () => {
        spawn('true');
        return { outcome: 'passed' };
      },
    }),
  },
});

const text = (marker: string) =>
  defineComponent({ render: () => h('p', marker) });

export const views = {
  'acme.surfaces.one': defineAnswerView(text('VIEW_ONE_MARKER')),
  'acme.surfaces.two': defineAnswerView(text(shout('VIEW_TWO_MARKER'))),
  'acme.surfaces.three': defineAnswerView(text('VIEW_THREE_MARKER')),
};

export const panels = {
  'acme.surfaces.first': defineExtensionPanel(text('PANEL_FIRST_MARKER')),
  'acme.surfaces.second': defineExtensionPanel(text('PANEL_SECOND_MARKER')),
};

export const widgets = {
  'acme.surfaces.card': defineExtensionWidget(text('WIDGET_CARD_MARKER')),
  'acme.surfaces.gauge': defineExtensionWidget(text('WIDGET_GAUGE_MARKER')),
  'acme.surfaces.badge': defineExtensionWidget(text('WIDGET_BADGE_MARKER')),
};

export const markdown = {
  alpha: defineMarkdownRenderer(text('ALPHA_MARKER')),
  beta: defineMarkdownRenderer(text('BETA_MARKER')),
};
