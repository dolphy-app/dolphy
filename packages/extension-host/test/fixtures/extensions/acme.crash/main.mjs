export const server = (s) => {
  s.registerExerciseType({
    id: 'acme.crash',
    specSchema: {
      type: 'object',
      required: ['expected'],
      properties: { expected: { type: 'string' } },
    },
    answerSchema: { type: 'string' },
    project: () => ({}),
    grade: ({ answer }) => {
      if (answer === 'crash') process.exit(3);
      return { outcome: 'passed' };
    },
  });
};
