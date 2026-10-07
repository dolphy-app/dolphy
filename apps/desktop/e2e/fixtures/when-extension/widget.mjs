// Виджет для e2e условий `when`: короткая надпись.
const { defineComponent, h } = await globalThis.__dolphy.require('vue');

const Widget = defineComponent({
  render: () => h('p', 'Виджет условий'),
});

export default {
  widgets: { 'acme.when.focused-card': Widget, 'acme.when.free-card': Widget },
};
