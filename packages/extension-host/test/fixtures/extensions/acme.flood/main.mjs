export const server = (s) => {
  s.registerExerciseType({
    id: 'acme.flood',
    specSchema: {
      type: 'object',
      required: ['expected'],
      properties: { expected: { type: 'string' } },
    },
    answerSchema: { type: 'string' },
    project: () => ({}),
    grade: ({ answer }) => {
      // запись в журнал не меньше 2 МиБ: сообщение процесса превышает предел IPC
      if (answer === 'big') {
        s.logger.info({ blob: 'x'.repeat(2 * 1024 * 1024) }, 'flood');
      }
      return { outcome: 'passed' };
    },
  });
};
