// Версия 1.1.0: засчитывает любой непустой ответ (отличается от 1.0.0, где нужен точный).
export default {
  activate(ctx) {
    ctx.registerExerciseType('acme.echo', {
      project: () => ({}),
      grade: ({ answer }) =>
        answer.length > 0
          ? { outcome: 'passed' }
          : { outcome: 'failed', reason: 'empty' },
      referenceAnswer: ({ spec }) => spec.expected,
    });
  },
};
