export default {
  activate(ctx) {
    ctx.registerExerciseType('acme.crash', {
      project: () => ({}),
      grade: ({ answer }) => {
        if (answer === 'crash') process.exit(3);
        return { outcome: 'passed' };
      },
    });
  },
};
