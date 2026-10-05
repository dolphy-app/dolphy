// Контрольное расширение: по срабатыванию увеличивает счётчик в ctx.storage;
// команда «Проверить связь» отвечает, только когда хост расширений подключён к движку
// (запрос к хосту ждёт подключения): так e2e узнаёт, что срабатывание не потеряется.
export default {
  activate(ctx) {
    ctx.commands.register('acme.control.ping', () => ({ notify: 'Связь есть' }));
    ctx.schedule.on('acme.control.hourly', async () => {
      await ctx.storage.set(
        'fired.hourly',
        ((await ctx.storage.get('fired.hourly')) ?? 0) + 1,
      );
    });
  },
};
