// Команды для e2e: уведомление, открытие панели, данные из storage, сбой, зависание.
let opened = 0;

export const server = (s) => {
  s.registerCommand({
    id: 'acme.commands.greet',
    title: 'Поприветствовать',
    description: 'Показывает уведомление',
    category: 'Приветствия',
    keybindings: [{ key: 'Mod+Shift+G' }],
    run: () => ({ notify: 'Привет, <b>мир</b>' }),
  });
  s.registerCommand({
    id: 'acme.commands.open',
    title: 'Открыть панель приветствий',
    category: 'Приветствия',
    keybindings: [
      { key: 'Mod+Shift+O', mac: 'Mod+Alt+O' },
      { key: 'Mod+Shift+P', when: "page == 'settings'" },
    ],
    run: () => {
      opened += 1;
      return {
        openPanel: 'acme.commands.main',
        props: { from: 'command', opened },
      };
    },
  });
  s.registerCommand({
    id: 'acme.commands.bump',
    title: 'Прибавить счётчик',
    palette: false,
    run: async () => {
      const count = ((await s.storage.get('count')) ?? 0) + 1;
      await s.storage.set('count', count);
      return { count };
    },
  });
  s.registerCommand({
    id: 'acme.commands.boom',
    title: 'Сломаться',
    category: 'Сбои',
    run: () => {
      throw new Error('кубик сломан');
    },
  });
  // обработчик, который не возвращается: приложение получает ошибку по сроку
  s.registerCommand({
    id: 'acme.commands.hang',
    title: 'Зависнуть',
    category: 'Сбои',
    run: () => new Promise(() => {}),
  });
};
