// Расширение с расписаниями для проверки ограниченного процесса.

export default {
  activate(ctx) {
    ctx.schedule.on('acme.sched.pid', async () => {
      await ctx.storage.set('pid', process.pid);
    });
    ctx.schedule.on('acme.sched.fail', () => {
      throw new Error('child boom');
    });
    // синхронный бесконечный цикл: обработчик не может ни завершиться, ни быть прерван таймером
    ctx.schedule.on('acme.sched.spin', () => {
      for (;;);
    });
  },
};
