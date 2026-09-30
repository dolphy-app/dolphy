// Вид задания, который засчитывает любой ответ: проверяется только интерфейс.
export default {
  activate(ctx) {
    ctx.registerExerciseType('acme.hostile-ui', {
      project: () => ({}),
      grade: () => ({ outcome: 'passed' }),
    });
  },
};
