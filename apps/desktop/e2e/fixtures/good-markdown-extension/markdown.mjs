// Рендерер, который выводит видимую строку: проверяет вывод блока в изолированной рамке.
export default {
  render(source, container) {
    const line = document.createElement('p');
    line.textContent = `good block: ${source.trim()}`;
    container.append(line);
  },
};
