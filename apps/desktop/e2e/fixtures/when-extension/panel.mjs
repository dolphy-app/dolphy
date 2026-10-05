// Панель для e2e: вызывает скрытую команду, чьё условие `when` сейчас ложно.
export default {
  mount(container, ctx) {
    const doc = container.ownerDocument;
    const result = doc.createElement('p');
    result.setAttribute('data-role', 'result');
    const button = doc.createElement('button');
    button.textContent = 'Позвать';
    button.addEventListener('click', async () => {
      try {
        const value = await ctx.call('acme.when.ping');
        result.textContent = `ok ${JSON.stringify(value)}`;
      } catch (error) {
        result.textContent = `Ошибка: ${error.message}`;
      }
    });
    const heading = doc.createElement('h2');
    heading.textContent = 'Панель условий';
    container.append(heading, button, result);
  },
};
