export const server = (s) => {
  s.registerExerciseType({
    id: 'acme.echo',
    specSchema: {
      type: 'object',
      required: ['expected'],
      additionalProperties: false,
      properties: { expected: { type: 'string', minLength: 1 } },
    },
    answerSchema: { type: 'string' },
    project: () => ({}),
    grade: ({ answer }) =>
      answer.length > 0
        ? { outcome: 'passed' }
        : { outcome: 'failed', reason: 'empty' },
    referenceAnswer: ({ spec }) => spec.expected,
  });
};
