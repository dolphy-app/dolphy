export default {
  render(source, container) {
    const line = document.createElement('p');
    line.textContent = source.trim();
    container.append(line);
  },
};
