// Виджет для e2e условий `when`: короткая надпись.
export default {
  mount(container) {
    const text = container.ownerDocument.createElement('p');
    text.textContent = 'Виджет условий';
    container.append(text);
  },
};
