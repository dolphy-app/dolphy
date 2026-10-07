export const server = (s) => {
  s.registerGradePolicy({
    id: 'acme.policy.generous',
    label: 'Generous',
    evaluate: ({ verdicts, gaveUp }) => {
      if (gaveUp) return 1;
      return verdicts.some(({ outcome }) => outcome === 'passed') ? 5 : null;
    },
  });
};
