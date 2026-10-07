// Расширение с богатыми настройками: вид задания отвечает отчётом о значениях
// настроек, какими их видит код (`failed` оставляет попытку открытой).
let changes = 0;

export const server = (s) => {
  const report = () => ({
    changes,
    advanced: s.settings.get('acme.rich.advanced'),
    note: s.settings.get('acme.rich.note'),
    tags: s.settings.get('acme.rich.tags'),
    tint: s.settings.get('acme.rich.tint'),
    secret: s.settings.get('acme.rich.secret'),
  });

  s.registerSettings([
    {
      id: 'acme.rich.advanced',
      type: 'boolean',
      label: 'Расширенный режим',
      default: false,
    },
    {
      id: 'acme.rich.note',
      type: 'text',
      label: 'Заметка',
      default: 'первая\nвторая',
      maxLength: 40,
      group: 'Содержимое',
      order: 2,
    },
    {
      id: 'acme.rich.tags',
      type: 'list',
      label: 'Метки',
      description: 'До трёх меток',
      default: ['alpha'],
      maxItems: 3,
      itemMaxLength: 6,
      group: 'Содержимое',
      order: 1,
    },
    {
      id: 'acme.rich.tint',
      type: 'color',
      label: 'Цвет акцента',
      default: '#336699',
      group: 'Оформление',
    },
    {
      id: 'acme.rich.secret',
      type: 'string',
      label: 'Скрытая настройка',
      default: 'x',
      group: 'Дополнительно',
      visibleWhen: { setting: 'acme.rich.advanced', equals: true },
    },
  ]);
  s.settings.onDidChange(() => {
    changes += 1;
  });
  s.registerExerciseType({
    id: 'acme.rich',
    title: 'Богатый вид',
    specSchema: { type: 'object' },
    answerSchema: { type: 'string' },
    project: () => ({}),
    grade: async () => ({
      outcome: 'failed',
      reason: 'report',
      feedback: JSON.stringify(report()),
    }),
  });
};
