// Команда записывает в ctx.storage всё, что вернул s.stats.
const pad = (value) => String(value).padStart(2, '0');

/** Местная дата `YYYY-MM-DD` со сдвигом в днях от сегодня: тот же пояс, что у движка. */
const localDate = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const failure = (error) => ({
  name: error.name,
  code: error.code ?? null,
});

export const server = (s) => {
  s.registerCommand({
    id: 'acme.stats.report',
    title: 'Статистика: записать',
    run: async () => {
      const from = localDate(-3);
      const to = localDate(0);
      let invalid = null;
      try {
        await s.stats.daily({ from: '2024-02-30', to: '2024-03-01' });
      } catch (error) {
        invalid = failure(error);
      }
      await s.storage.set('report', {
        from,
        to,
        streak: await s.stats.streak(),
        daily: await s.stats.daily({ from, to }),
        alpha: {
          streak: await s.stats.streak({ courseId: 'alpha_kb' }),
          daily: await s.stats.daily({ from, to, courseId: 'alpha_kb' }),
        },
        unknown: await s.stats.streak({ courseId: 'nope_kb' }),
        invalid,
      });
      return { notify: 'Статистика записана' };
    },
  });
};
