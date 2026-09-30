export default {
  activate(ctx) {
    ctx.registerGradePolicy('acme.policy.generous', ({ verdicts, gaveUp }) => {
      if (gaveUp) return 1;
      return verdicts.some(({ outcome }) => outcome === 'passed') ? 5 : null;
    });
  },
};
