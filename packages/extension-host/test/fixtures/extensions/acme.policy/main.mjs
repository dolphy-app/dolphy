export default {
  activate(ctx) {
    ctx.registerGradePolicy('acme.policy.generous', ({ verdicts, gaveUp }) =>
      gaveUp
        ? 1
        : verdicts.some(({ outcome }) => outcome === 'passed')
          ? 5
          : null,
    );
    ctx.registerGradePolicy('acme.policy.broken', () => 7);
    ctx.registerGradePolicy('acme.policy.throws', () => {
      throw new Error('policy exploded');
    });
  },
};
