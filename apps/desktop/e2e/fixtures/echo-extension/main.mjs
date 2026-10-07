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
    grade: ({ spec, answer }) =>
      answer === spec.expected
        ? { outcome: 'passed' }
        : { outcome: 'failed', reason: 'mismatch' },
    referenceAnswer: ({ spec }) => spec.expected,
  });
};
