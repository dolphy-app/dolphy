// Секреты для e2e: каждая команда сообщает исход уведомлением (значение или имя ошибки).
const SECRET_VALUE = 'сек-ret-e2e-7f3a';

export default {
  activate(ctx) {
    const outcome = (run) => async () => {
      try {
        return { notify: await run() };
      } catch (error) {
        return { notify: `error:${error.name}` };
      }
    };
    ctx.commands.register(
      'acme.secrets.save',
      outcome(async () => {
        await ctx.secrets.set('token', SECRET_VALUE);
        return 'saved';
      }),
    );
    ctx.commands.register(
      'acme.secrets.read',
      outcome(
        async () => `value:${(await ctx.secrets.get('token')) ?? 'none'}`,
      ),
    );
    ctx.commands.register(
      'acme.secrets.drop',
      outcome(async () => `deleted:${await ctx.secrets.delete('token')}`),
    );
  },
};
