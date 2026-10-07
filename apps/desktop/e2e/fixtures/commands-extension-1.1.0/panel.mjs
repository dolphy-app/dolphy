// Панель для e2e: показывает свойства и счётчик, вызывает команды своего расширения.
// Компонент Vue в окне приложения, без сборки.
const { defineComponent, h, inject, ref } =
  await globalThis.__dolphy.require('vue');

const VERSION = '1.1.0';

const Panel = defineComponent({
  setup() {
    const panel = inject(Symbol.for('dolphy.extension.panel'));
    const count = ref('—');
    const result = ref('');

    const attempt = async (command, onValue) => {
      try {
        const value = await panel.call(command);
        result.value = 'ok';
        onValue?.(value);
      } catch (error) {
        result.value = `Ошибка: ${error.message}`;
      }
    };
    const button = (label, action) => h('button', { onClick: action }, label);

    return () =>
      h('div', [
        h('h2', `Панель приветствий v${VERSION}`),
        h('p', { 'data-role': 'panel-id' }, panel.panelId),
        h(
          'p',
          { 'data-role': 'props' },
          `Свойства: ${JSON.stringify(panel.props ?? null)}`,
        ),
        h('p', { 'data-role': 'count' }, `Счётчик: ${count.value}`),
        h('p', { 'data-role': 'result' }, result.value),
        button('Прибавить', () =>
          attempt('acme.commands.bump', (value) => {
            count.value = value.count;
          }),
        ),
        button('Уведомить', () => attempt('acme.commands.greet')),
        button('Открыть снова', () => attempt('acme.commands.open')),
        button('Сломать', () => attempt('acme.commands.boom')),
        button('Чужая команда', () => attempt('acme.victim.mark')),
        h('input', { 'aria-label': 'Поле панели' }),
      ]);
  },
});

export default { panels: { 'acme.commands.main': Panel } };
