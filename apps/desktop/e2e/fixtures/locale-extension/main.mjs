// Расширение с переводимыми подписями: `LocalizedText` `{ en, ru }` в коде; `lonely` — без перевода.
export const server = (s) => {
  s.registerExerciseType({
    id: 'acme.locale',
    title: { en: 'Locale kind', ru: 'Вид с переводом' },
    specSchema: { type: 'object' },
    answerSchema: { type: 'string' },
    project: () => ({}),
    grade: async () => ({ outcome: 'passed' }),
  });
  s.registerGradePolicy({
    id: 'acme.locale.policy',
    label: { en: 'Locale policy', ru: 'Правило с переводом' },
    evaluate: () => null,
  });
  s.registerSettings([
    {
      id: 'acme.locale.mode',
      type: 'enum',
      label: { en: 'Speed', ru: 'Скорость' },
      description: { en: 'How fast to go', ru: 'Как быстро идти' },
      group: { en: 'Behavior', ru: 'Поведение' },
      default: 'fast',
      options: [
        { value: 'fast', label: { en: 'Fast', ru: 'Быстро' } },
        { value: 'slow', label: { en: 'Slow', ru: 'Медленно' } },
      ],
    },
    {
      id: 'acme.locale.lonely',
      type: 'boolean',
      label: { en: 'Lonely switch' },
      description: { en: 'Only in en' },
      group: { en: 'Behavior', ru: 'Поведение' },
      default: false,
    },
  ]);
  s.registerCommand({
    id: 'acme.locale.go',
    title: { en: 'Go there', ru: 'Перейти туда' },
    description: {
      en: 'Runs the locale command',
      ru: 'Запускает команду перевода',
    },
    category: { en: 'Locale', ru: 'Перевод' },
    run: () => undefined,
  });
};
