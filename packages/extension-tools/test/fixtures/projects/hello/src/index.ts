import { defineComponent, h } from 'vue';

const input = defineComponent({ render: () => h('input') });

export const server = (s) => {
  s.registerExerciseType({
    id: 'acme.hello',
    title: 'Hello exercise',
    specSchema: {
      type: 'object',
      required: ['expected'],
      properties: { expected: { type: 'string' } },
    },
    answerSchema: { type: 'string' },
    project: () => ({}),
    grade: ({ spec, answer }) =>
      answer === spec.expected
        ? { outcome: 'passed' }
        : { outcome: 'failed', reason: 'mismatch' },
  });
};

export const client = (c) => {
  c.addAnswerView('acme.hello', input);
};
