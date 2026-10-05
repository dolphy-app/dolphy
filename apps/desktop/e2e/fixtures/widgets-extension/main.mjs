// Команды для e2e виджетов: счётчик в ctx.storage, открытие панели.
export default {
  activate(ctx) {
    ctx.commands.register('acme.widgets.open', () => ({
      openPanel: 'acme.widgets.main',
    }));
    ctx.commands.register('acme.widgets.count', async () => {
      const count = ((await ctx.storage.get('count')) ?? 0) + 1;
      await ctx.storage.set('count', count);
      return { count };
    });
    ctx.commands.register('acme.widgets.plain', () => undefined);
  },
};
