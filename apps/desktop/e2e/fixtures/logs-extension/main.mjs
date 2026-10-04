// Команда пишет в журнал через ctx.logger: запись должна нести id расширения в обоих режимах исполнения.
let count = 0;

export default {
  activate(ctx) {
    ctx.commands.register('acme.logs.say', () => {
      count += 1;
      ctx.logger.warn({ count }, `acme.logs says hello ${count}`);
      return { count };
    });
  },
};
