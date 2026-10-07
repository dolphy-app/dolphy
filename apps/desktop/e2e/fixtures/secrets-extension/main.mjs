// Секреты для e2e: каждая команда сообщает исход уведомлением (значение или имя ошибки).
const SECRET_VALUE = 'сек-ret-e2e-7f3a';

export const server = (s) => {
  const outcome = (run) => async () => {
    try {
      return { notify: await run() };
    } catch (error) {
      return { notify: `error:${error.name}` };
    }
  };
  s.registerCommand({
    id: 'acme.secrets.save',
    title: 'Секрет: сохранить',
    run: outcome(async () => {
      await s.secrets.set('token', SECRET_VALUE);
      return 'saved';
    }),
  });
  s.registerCommand({
    id: 'acme.secrets.read',
    title: 'Секрет: прочитать',
    run: outcome(
      async () => `value:${(await s.secrets.get('token')) ?? 'none'}`,
    ),
  });
  s.registerCommand({
    id: 'acme.secrets.drop',
    title: 'Секрет: удалить',
    run: outcome(async () => `deleted:${await s.secrets.delete('token')}`),
  });
};
