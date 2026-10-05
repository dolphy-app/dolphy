// Команды для e2e условий `when`: каждая отвечает уведомлением со своим именем.
export default {
  activate(ctx) {
    for (const name of ['courses', 'plain', 'focused', 'night']) {
      ctx.commands.register(`acme.when.${name}`, () => ({
        notify: `Выполнено: ${name}`,
      }));
    }
    ctx.commands.register('acme.when.open', () => ({
      openPanel: 'acme.when.main',
    }));
    ctx.commands.register('acme.when.ping', () => ({ pong: true }));
  },
};
