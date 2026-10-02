// Расширение с состоянием: всё, что оно видит, оно записывает в своё хранилище, откуда тест читает у движка.
export default {
  async activate(ctx) {
    const greeting = () => ctx.settings.get('acme.stateful.greeting');
    await ctx.storage.set(
      'activations',
      ((await ctx.storage.get('activations')) ?? 0) + 1,
    );
    await ctx.storage.set('greeting-at-start', greeting());
    ctx.events.on('attempt.closed', async (payload) => {
      await ctx.storage.set(`attempt:${payload.exerciseId}`, {
        grade: payload.grade,
        greeting: greeting(),
      });
    });
    ctx.events.on('session.started', async () => {
      try {
        await ctx.storage.set('x'.repeat(200), 1);
      } catch (error) {
        await ctx.storage.set('quota', {
          name: error.name,
          kind: error.kind,
          limit: error.limit,
        });
      }
    });
    ctx.settings.onDidChange(async ({ id, value }) => {
      await ctx.storage.set('changed', { id, value });
    });
  },
};
