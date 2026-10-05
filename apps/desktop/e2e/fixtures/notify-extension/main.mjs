// Расширение с `notifications`: команды показывают уведомления и записывают в ctx.storage, что вернул show.
const failure = (error) => ({
  name: error.name,
  code: error.code ?? null,
  window: error.window ?? null,
  limit: error.limit ?? null,
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
    ctx.commands.register('acme.notify.one', async () => {
      const shown = await ctx.notifications.show({
        title: 'Серия продолжается',
        body: 'Ещё один день\u0000 подряд',
      });
      const runs = (await ctx.storage.get('runs')) ?? [];
      await ctx.storage.set('runs', [...runs, shown]);
      return { notify: shown ? 'показано' : 'не показано' };
    });
    ctx.commands.register('acme.notify.many', async () => {
      const results = [];
      for (let i = 1; i <= 5; i += 1) {
        results.push(
          await attempt(() =>
            ctx.notifications.show({ title: `Напоминание ${i}`, body: '' }),
          ),
        );
      }
      await ctx.storage.set('many', results);
      return { notify: 'готово' };
    });
    ctx.commands.register('acme.notify.long', async () => {
      await ctx.storage.set(
        'long',
        await attempt(() =>
          ctx.notifications.show({ title: 'x'.repeat(81), body: '' }),
        ),
      );
      return { notify: 'готово' };
    });
  },
};
