// Расширение с переводимыми подписями: код нужен только для регистрации вкладов.
export default {
  activate(ctx) {
    ctx.registerExerciseType('acme.locale', {
      project: () => ({}),
      grade: async () => ({ outcome: 'passed' }),
    });
    ctx.registerGradePolicy('acme.locale.policy', () => null);
    ctx.commands.register('acme.locale.go', () => undefined);
  },
};
