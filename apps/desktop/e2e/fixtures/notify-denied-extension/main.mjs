// Расширение без `notifications`: show должен отказать, а не показать уведомление.
export default {
  activate(ctx) {
    ctx.commands.register('acme.nonotify.show', async () => {
      let error = null;
      try {
        await ctx.notifications.show({ title: 'Тайно', body: '' });
      } catch (caught) {
        error = {
          name: caught.name,
          code: caught.code ?? null,
          permission: caught.permission ?? null,
        };
      }
      await ctx.storage.set('report', { error });
      return { notify: 'Попытка записана' };
    });
  },
};
