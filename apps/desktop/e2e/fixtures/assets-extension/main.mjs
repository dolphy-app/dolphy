// Вид задания, который засчитывает любой ответ: проверяются только ресурсы в рамках.
export default {
  activate(ctx) {
    ctx.registerExerciseType('acme.assets', {
      project: () => ({}),
      grade: () => ({ outcome: 'passed' }),
    });
  },
};
