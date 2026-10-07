import { defineServer, openPanel } from '@dolphy-app/extension-sdk';

export const server = defineServer((s) => {
  s.registerCommand({
    id: 'acme.injection.open',
    title: { en: 'Open the injection panel', ru: 'Открыть панель инъекций' },
    category: { en: 'Injections', ru: 'Инъекции' },
    icon: 'fire',
    run: () => openPanel('acme.injection.main'),
  });
  s.registerCommand({
    id: 'acme.injection.count',
    title: 'Прибавить счётчик',
    palette: false,
    icon: 'trophy',
    run: async () => {
      const count = ((await s.storage.get<number>('count')) ?? 0) + 1;
      await s.storage.set('count', count);
      return { count };
    },
  });
  s.registerCommand({
    id: 'acme.injection.plain',
    title: 'Команда без значка',
    run: () => undefined,
  });
});
