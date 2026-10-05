// Расширение с расписаниями: каждое срабатывание увеличивает свой счётчик в ctx.storage
// (расширение изолировано: код идёт в ограниченном процессе; ключи разные — срабатывания одного момента идут параллельно).
const count = (ctx, id) => async () => {
  await ctx.storage.set(
    `fired.${id}`,
    ((await ctx.storage.get(`fired.${id}`)) ?? 0) + 1,
  );
};

export default {
  activate(ctx) {
    ctx.schedule.on('acme.schedule.morning', count(ctx, 'morning'));
    ctx.schedule.on('acme.schedule.hourly', count(ctx, 'hourly'));
  },
};
