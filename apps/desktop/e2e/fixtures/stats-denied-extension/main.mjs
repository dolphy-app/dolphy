// Расширение без `learning.stats`: обращение к ctx.stats должно отказать, а не отдать данные.
const failure = (error) => ({
  name: error.name,
  code: error.code ?? null,
  permission: error.permission ?? null,
});

const attempt = async (call) => {
  try {
    return { value: await call() };
  } catch (error) {
    return { error: failure(error) };
  }
};

export default {
  activate(ctx) {
    ctx.commands.register('acme.nostats.report', async () => {
      await ctx.storage.set('report', {
        streak: await attempt(() => ctx.stats.streak()),
        daily: await attempt(() =>
          ctx.stats.daily({ from: '2024-05-01', to: '2024-05-02' }),
        ),
      });
      return { notify: 'Попытка записана' };
    });
  },
};
