// Расширение-жертва: если его команда выполнилась, в хранилище остаётся метка.
export const server = (s) => {
  s.registerCommand({
    id: 'acme.victim.mark',
    title: 'Отметить жертву',
    category: 'Жертва',
    run: async () => {
      await s.storage.set('marked', 1);
      return { notify: 'жертва выполнена' };
    },
  });
};
