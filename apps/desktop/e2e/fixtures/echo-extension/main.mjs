export default {
  activate(ctx) {
    ctx.registerExerciseType('acme.echo', {
      project: () => ({}),
      grade: ({ spec, answer }) =>
        answer === spec.expected
          ? { outcome: 'passed' }
          : { outcome: 'failed', reason: 'mismatch' },
      referenceAnswer: ({ spec }) => spec.expected,
    });
  },
};
