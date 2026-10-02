// Команды для e2e: уведомление, открытие панели, данные из ctx.storage, сбой, зависание.
let opened = 0;

export default {
  activate(ctx) {
    ctx.commands.register('acme.commands.greet', () => ({
      notify: 'Привет, <b>мир</b>',
    }));
    ctx.commands.register('acme.commands.open', () => {
      opened += 1;
      return {
        openPanel: 'acme.commands.main',
        props: { from: 'command', opened },
      };
    });
    ctx.commands.register('acme.commands.bump', async () => {
      const count = ((await ctx.storage.get('count')) ?? 0) + 1;
      await ctx.storage.set('count', count);
      return { count };
    });
    ctx.commands.register('acme.commands.boom', () => {
      throw new Error('кубик сломан');
    });
    // обработчик, который не возвращается: приложение получает ошибку по сроку
    ctx.commands.register('acme.commands.hang', () => new Promise(() => {}));
  },
};
