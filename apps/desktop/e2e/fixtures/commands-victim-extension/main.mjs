// Расширение-жертва: если его команда выполнилась, в хранилище остаётся метка.
export default {
  activate(ctx) {
    ctx.commands.register('acme.victim.mark', async () => {
      await ctx.storage.set('marked', 1);
      return { notify: 'жертва выполнена' };
    });
  },
};
