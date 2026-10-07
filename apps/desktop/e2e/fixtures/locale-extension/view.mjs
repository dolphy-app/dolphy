const { defineComponent, h } = await globalThis.__dolphy.require('vue');

const Answer = defineComponent({
  props: ['view', 'value', 'disabled', 'verdict', 'label'],
  emits: ['change', 'submit'],
  render: () => h('div', { 'data-testid': 'acme-locale-answer' }),
});

export default { views: { 'acme.locale': Answer } };
