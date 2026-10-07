import { spawn } from 'node:child_process';
import { defineComponent, h } from 'vue';
import { shout } from './shout.ts';

const text = (marker: string) =>
  defineComponent({ render: () => h('p', marker) });

export const server = (s) => {
  s.registerExerciseType({
    id: 'acme.surfaces.one',
    specSchema: { type: 'object' },
    answerSchema: { type: 'string' },
    project: () => 'SERVER_ONLY_MARKER',
    grade: () => {
      spawn('true');
      return { outcome: 'passed' };
    },
  });
};

export const client = (c) => {
  c.addAnswerView('acme.surfaces.one', text('VIEW_ONE_MARKER'));
  c.addAnswerView('acme.surfaces.two', text(shout('VIEW_TWO_MARKER')));
  c.addPanel({
    id: 'acme.surfaces.first',
    title: 'First',
    component: text('PANEL_FIRST_MARKER'),
  });
  c.addInjection({
    id: 'acme.surfaces.plan',
    target: '[data-ext-anchor="dailyPlan"]',
    component: text('INJECTION_CARD_MARKER'),
  });
  c.addMarkdownRenderer('alpha', text('ALPHA_MARKER'));
};
