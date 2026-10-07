// Расширение с расписаниями: каждое срабатывание увеличивает свой счётчик в s.storage
// (ключи разные — срабатывания одного момента идут параллельно).
export const server = (s) => {
  const count = (id) => async () => {
    await s.storage.set(
      `fired.${id}`,
      ((await s.storage.get(`fired.${id}`)) ?? 0) + 1,
    );
  };
  s.schedule(
    { id: 'acme.schedule.morning', every: 'daily', at: '09:00' },
    count('morning'),
  );
  s.schedule({ id: 'acme.schedule.hourly', every: 'hourly' }, count('hourly'));
};
