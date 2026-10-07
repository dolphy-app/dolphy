export const server = (s) => {
  s.registerGradePolicy({
    id: 'acme.policy.generous',
    label: 'Generous',
    evaluate: ({ verdicts, gaveUp }) =>
      gaveUp
        ? 1
        : verdicts.some(({ outcome }) => outcome === 'passed')
          ? 5
          : null,
  });
  s.registerGradePolicy({
    id: 'acme.policy.broken',
    label: 'Broken',
    evaluate: () => 7,
  });
  s.registerGradePolicy({
    id: 'acme.policy.throws',
    label: 'Throws',
    evaluate: () => {
      throw new Error('policy exploded');
    },
  });
};
