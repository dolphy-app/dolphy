import { defineAnswerView, defineExtension } from '@dolphy-app/extension-sdk';

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

export const views = {
  'acme.hello': defineAnswerView(() => ({ update() {} })),
};
