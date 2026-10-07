// Панель для e2e: вызывает скрытую команду, чьё условие `when` сейчас ложно.
const { defineComponent, h, inject, ref } =
  await globalThis.__dolphy.require('vue');

const Panel = defineComponent({
  setup() {
    const panel = inject(Symbol.for('dolphy.extension.panel'));
    const result = ref('');
    const call = async () => {
      try {
        const value = await panel.call('acme.when.ping');
        result.value = `ok ${JSON.stringify(value)}`;
      } catch (error) {
        result.value = `Ошибка: ${error.message}`;
      }
    };
    return () =>
      h('div', [
        h('h2', 'Панель условий'),
        h('button', { onClick: call }, 'Позвать'),
        h('p', { 'data-role': 'result' }, result.value),
      ]);
  },
});

export default { panels: { 'acme.when.main': Panel } };
