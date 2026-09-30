export default {
  activate(ctx) {
    ctx.registerExerciseType('acme.echo', {
      project: ({ spec }) => ({ hint: spec.expected.length }),
      grade: ({ spec, answer }) =>
        answer === spec.expected
          ? { outcome: 'passed' }
          : { outcome: 'failed', reason: 'mismatch' },
      referenceAnswer: ({ spec }) => spec.expected,
    });
  },
};
