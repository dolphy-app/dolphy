// Команды для e2e условий `when`: каждая отвечает уведомлением со своим именем.
export const server = (s) => {
  const named = [
    [
      'courses',
      'Только на «Курсах»',
      { when: "route == 'courses'", keybindings: [{ key: 'Mod+Shift+J' }] },
    ],
    ['plain', 'Всегда', {}],
    ['focused', 'Только с курсом в фокусе', { when: 'course.active' }],
    ['night', 'Только в тёмной теме', { when: 'theme.dark' }],
  ];
  for (const [name, title, rest] of named) {
    s.registerCommand({
      id: `acme.when.${name}`,
      title,
      category: 'Условия',
      ...rest,
      run: () => ({ notify: `Выполнено: ${name}` }),
    });
  }
  s.registerCommand({
    id: 'acme.when.open',
    title: 'Открыть панель условий',
    category: 'Условия',
    run: () => ({ openPanel: 'acme.when.main' }),
  });
  s.registerCommand({
    id: 'acme.when.ping',
    title: 'Скрытая команда',
    palette: false,
    when: "route == 'courses'",
    run: () => ({ pong: true }),
  });
};
