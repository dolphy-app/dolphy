export default {
  mount(container) {
    const text = container.ownerDocument.createElement('p');
    text.textContent = 'locale panel';
    container.append(text);
  },
};
