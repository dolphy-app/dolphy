export default {
  activate(ctx) {
    ctx.registerExerciseType('acme.flood', {
      project: () => ({}),
      grade: ({ answer }) => {
        // запись в журнал не меньше 2 МиБ: сообщение процесса превышает предел IPC
        if (answer === 'big') {
          ctx.logger.info({ blob: 'x'.repeat(2 * 1024 * 1024) }, 'flood');
        }
        return { outcome: 'passed' };
      },
    });
  },
};
