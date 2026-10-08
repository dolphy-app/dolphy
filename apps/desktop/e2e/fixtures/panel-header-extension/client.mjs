// Две панели для e2e: с шапкой приложения (по умолчанию) и без неё (`header: false`).
const { defineComponent, h } = await globalThis.__dolphy.require('vue');

const Own = defineComponent({
  render: () =>
    h('div', { 'data-role': 'own' }, [
      h('h1', 'Своя страница'),
      h('button', 'Действие'),
    ]),
});

const Standard = defineComponent({
  render: () => h('div', { 'data-role': 'standard' }, 'Обычное содержимое'),
});

export const client = (c) => {
  c.addPanel({
    id: 'acme.hdr.own',
    title: 'Панель без шапки',
    header: false,
    component: Own,
  });
  c.addPanel({
    id: 'acme.hdr.std',
    title: 'Панель с шапкой',
    component: Standard,
  });
};
