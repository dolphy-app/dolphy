// Контрольное расширение: по срабатыванию увеличивает счётчик в ctx.storage.
export default {
  activate(ctx) {
    ctx.schedule.on('acme.control.hourly', async () => {
      await ctx.storage.set(
        'fired.hourly',
        ((await ctx.storage.get('fired.hourly')) ?? 0) + 1,
      );
    });
  },
};
