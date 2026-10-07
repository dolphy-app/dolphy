// Команды показывают уведомления и записывают в storage, что вернул show.
const failure = (error) => ({
  name: error.name,
  code: error.code ?? null,
  window: error.window ?? null,
  limit: error.limit ?? null,
});

const attempt = async (call) => {
  try {
    return { value: await call() };
  } catch (error) {
    return { error: failure(error) };
  }
};

export const server = (s) => {
  s.registerCommand({
    id: 'acme.notify.one',
    title: 'Уведомление: показать',
    run: async () => {
      const shown = await s.notifications.show({
        title: 'Серия продолжается',
        body: 'Ещё один день\u0000 подряд',
      });
      const runs = (await s.storage.get('runs')) ?? [];
      await s.storage.set('runs', [...runs, shown]);
      return { notify: shown ? 'показано' : 'не показано' };
    },
  });
  s.registerCommand({
    id: 'acme.notify.many',
    title: 'Уведомление: много',
    run: async () => {
      const results = [];
      for (let i = 1; i <= 5; i += 1) {
        results.push(
          await attempt(() =>
            s.notifications.show({ title: `Напоминание ${i}`, body: '' }),
          ),
        );
      }
      await s.storage.set('many', results);
      return { notify: 'готово' };
    },
  });
  s.registerCommand({
    id: 'acme.notify.long',
    title: 'Уведомление: слишком длинное',
    run: async () => {
      await s.storage.set(
        'long',
        await attempt(() =>
          s.notifications.show({ title: 'x'.repeat(81), body: '' }),
        ),
      );
      return { notify: 'готово' };
    },
  });
};
