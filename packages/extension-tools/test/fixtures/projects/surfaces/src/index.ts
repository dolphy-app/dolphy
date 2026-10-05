import { spawn } from 'node:child_process';
import {
  defineAnswerView,
  defineExerciseType,
  defineExtension,
  defineExtensionPanel,
  defineExtensionWidget,
  defineMarkdownRenderer,
} from '@dolphy-app/extension-sdk';
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

const textView = (text: string) =>
  defineAnswerView((api) => {
    api.root.textContent = text;
    return { update() {} };
  });

export const views = {
  'acme.surfaces.one': textView('VIEW_ONE_MARKER'),
  'acme.surfaces.two': textView(shout('VIEW_TWO_MARKER')),
  'acme.surfaces.three': textView('VIEW_THREE_MARKER'),
};

export const panels = {
  'acme.surfaces.first': defineExtensionPanel({
    mount(container) {
      container.textContent = 'PANEL_FIRST_MARKER';
    },
  }),
  'acme.surfaces.second': defineExtensionPanel({
    mount(container) {
      container.textContent = 'PANEL_SECOND_MARKER';
    },
  }),
};

export const widgets = {
  'acme.surfaces.card': defineExtensionWidget({
    mount(container) {
      container.textContent = 'WIDGET_CARD_MARKER';
    },
  }),
  'acme.surfaces.gauge': defineExtensionWidget({
    mount(container) {
      container.textContent = 'WIDGET_GAUGE_MARKER';
    },
  }),
  'acme.surfaces.badge': defineExtensionWidget({
    mount(container) {
      container.textContent = 'WIDGET_BADGE_MARKER';
    },
  }),
};

export const markdown = {
  alpha: defineMarkdownRenderer((source, container) => {
    container.textContent = `ALPHA_MARKER ${source}`;
  }),
  beta: defineMarkdownRenderer((source, container) => {
    container.textContent = `BETA_MARKER ${source}`;
  }),
};
