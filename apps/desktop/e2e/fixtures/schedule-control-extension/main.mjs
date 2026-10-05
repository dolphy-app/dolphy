// Контрольное расширение: по срабатыванию записывает отметку в ctx.storage.
export default {
  activate(ctx) {
    ctx.schedule.on('acme.control.hourly', async () => {
      const fired = (await ctx.storage.get('fired')) ?? [];
      await ctx.storage.set('fired', [...fired, 'hourly']);
    });
  },
};
