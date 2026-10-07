// Команда пишет в журнал через logger: запись должна нести id расширения.
let count = 0;

export const server = (s) => {
  s.registerCommand({
    id: 'acme.logs.say',
    title: 'Записать в журнал',
    run: () => {
      count += 1;
      s.logger.warn({ count }, `acme.logs says hello ${count}`);
      return { count };
    },
  });
};
