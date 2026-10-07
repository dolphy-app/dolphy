// Вид ответа стороннего расширения: компонент Vue в окне, без сборки.
const { defineComponent, h } = await globalThis.__dolphy.require('vue');

const Answer = defineComponent({
  props: ['view', 'value', 'disabled', 'verdict', 'label'],
  emits: ['change', 'submit'],
  setup(props, { emit }) {
    const input = (event) => {
      const { value } = event.target;
      emit('change', { value, complete: value.length > 0 });
    };
    return () =>
      h('div', { 'data-testid': 'acme-rich-answer' }, [
        h('input', {
          type: 'text',
          'aria-label': props.label,
          disabled: props.disabled,
          value: typeof props.value === 'string' ? props.value : '',
          onInput: input,
        }),
      ]);
  },
});

export default { views: { 'acme.rich': Answer } };
