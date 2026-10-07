// Вид задания, который засчитывает любой ответ: проверяются только ресурсы в рамках.
export const server = (s) => {
  s.registerExerciseType({
    id: 'acme.assets',
    specSchema: { type: 'object' },
    answerSchema: { type: 'string' },
    project: () => ({}),
    grade: () => ({ outcome: 'passed' }),
  });
};
