// Соседнее расширение читает тот же ключ: своё пространство секретов у него пусто.
export const server = (s) => {
  s.registerCommand({
    id: 'acme.snoop.read',
    title: 'Чужой секрет: прочитать',
    run: async () => ({
      notify: `value:${(await s.secrets.get('token')) ?? 'none'}`,
    }),
  });
};
