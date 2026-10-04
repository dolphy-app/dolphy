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
    // секреты: исход каждой операции записывается в хранилище кода, откуда его читает тест
    let rounds = 0;
    ctx.events.on('session.finished', async () => {
      const attempt = async (run) => {
        try {
          return { value: (await run()) ?? null };
        } catch (error) {
          return { name: error.name, code: error.code };
        }
      };
      const report = {
        set: await attempt(() => ctx.secrets.set('token', 'сек-ret')),
        got: await attempt(() => ctx.secrets.get('token')),
        missing: await attempt(() => ctx.secrets.get('nope')),
        deleteMissing: await attempt(() => ctx.secrets.delete('gone')),
      };
      if (rounds > 0) {
        report.deleteExisting = await attempt(() => ctx.secrets.delete('token'));
      }
      await ctx.storage.set(`secrets:${rounds}`, report);
      rounds += 1;
    });
    ctx.settings.onDidChange(async ({ id, value }) => {
      await ctx.storage.set('changed', { id, value });
    });
  },
};
