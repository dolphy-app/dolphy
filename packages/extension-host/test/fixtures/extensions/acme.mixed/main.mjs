export const server = (s) => {
  s.registerExerciseType({
    id: 'acme.mixed',
    specSchema: { type: 'object' },
    answerSchema: { type: 'string' },
    project: () => ({}),
    grade: () => ({ outcome: 'passed' }),
  });
  s.registerGradePolicy({
    id: 'acme.mixed.strict',
    label: 'Strict',
    evaluate: () => null,
  });
};
