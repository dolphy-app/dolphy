import { defineAnswerView, defineExtension } from '@dolphy-app/extension-sdk';
import { defineComponent, h } from 'vue';

export const host = defineExtension({
  exerciseTypes: {
    'acme.hello': {
      project: () => ({}),
      grade: ({ spec, answer }) =>
        answer === (spec as { expected: string }).expected
          ? { outcome: 'passed' }
          : { outcome: 'failed', reason: 'mismatch' },
    },
  },
});

const input = defineComponent({ render: () => h('input') });

export const views = {
  'acme.hello': defineAnswerView(input),
};
