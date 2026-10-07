export const server = (s) => {
  s.registerExerciseType({
    id: 'acme.echo',
    specSchema: {
      type: 'object',
      required: ['expected'],
      properties: { expected: { type: 'string' } },
    },
    answerSchema: { type: 'string' },
    project: ({ spec }) => ({ hint: spec.expected.length }),
    grade: ({ spec, answer }) =>
      answer === spec.expected
        ? { outcome: 'passed' }
        : { outcome: 'failed', reason: 'mismatch' },
    referenceAnswer: ({ spec }) => spec.expected,
  });
};
