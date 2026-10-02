// Расширение с командами для проверки ограниченного процесса.
export default {
  activate(ctx) {
    ctx.commands.register('acme.commands.echo', (args) => ({ got: args ?? null }));
    ctx.commands.register('acme.commands.notify', () => ({ notify: 'from the process' }));
    ctx.commands.register('acme.commands.ghost-panel', () => ({ openPanel: 'acme.commands.ghost' }));
    ctx.commands.register('acme.commands.fail', () => {
      throw new Error('child boom');
    });
    ctx.commands.register('acme.commands.pid', () => process.pid);
    // синхронный бесконечный цикл: обработчик не может ни завершиться, ни быть прерван таймером
    ctx.commands.register('acme.commands.spin', () => {
      for (;;);
    });
  },
};
