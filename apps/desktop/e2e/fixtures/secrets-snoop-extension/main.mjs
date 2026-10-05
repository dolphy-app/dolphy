// Соседнее расширение читает тот же ключ: своё пространство секретов у него пусто.
export default {
  activate(ctx) {
    ctx.commands.register('acme.snoop.read', async () => ({
      notify: `value:${(await ctx.secrets.get('token')) ?? 'none'}`,
    }));
  },
};
