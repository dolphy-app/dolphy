export const server = (s) => {
  s.registerExerciseType({
    id: 'acme.minimal',
    specSchema: { type: 'object' },
    answerSchema: { type: 'string' },
    project: () => ({}),
    grade: () => ({ outcome: 'passed' }),
  });
};
