// Расширение с расписаниями: каждое срабатывание дописывает запись в ctx.storage (расширение изолировано: код идёт в ограниченном процессе).
const record = (ctx, id) => async () => {
  const fired = (await ctx.storage.get('fired')) ?? [];
  await ctx.storage.set('fired', [...fired, id]);
};

export default {
  activate(ctx) {
    ctx.schedule.on('acme.schedule.morning', record(ctx, 'morning'));
    ctx.schedule.on('acme.schedule.hourly', record(ctx, 'hourly'));
  },
};
