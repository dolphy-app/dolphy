// Контрольное расширение: по срабатыванию увеличивает счётчик в s.storage;
// команда «Проверить связь» отвечает, только когда хост расширений подключён к движку
// (запрос к хосту ждёт подключения): так e2e узнаёт, что срабатывание не потеряется.
export const server = (s) => {
  s.registerCommand({
    id: 'acme.control.ping',
    title: 'Проверить связь',
    run: () => ({ notify: 'Связь есть' }),
  });
  s.schedule({ id: 'acme.control.hourly', every: 'hourly' }, async () => {
    await s.storage.set(
      'fired.hourly',
      ((await s.storage.get('fired.hourly')) ?? 0) + 1,
    );
  });
};
