/** Вид ввода ответа `dolphy.sql`: многострочное моноширинное поле Vuetify. */
import type { AnswerChange } from '@dolphy-app/extension-api';
import { defineComponent, h, ref, watch } from 'vue';
import type { PropType } from 'vue';
import { VTextarea } from 'vuetify/components';

const ROWS = 6;

const toText = (value: unknown) => (typeof value === 'string' ? value : '');

const unknownProp = { type: null as unknown as PropType<unknown> };

export const SqlAnswerView = defineComponent({
  name: 'SqlAnswerView',
  props: {
    view: unknownProp,
    value: unknownProp,
    disabled: Boolean,
    verdict: unknownProp,
    label: { type: String as PropType<string | null>, default: null },
  },
  emits: ['change', 'submit'],
  setup(props, { emit }) {
    // текст заменяется только со сменой свойства `value`: приложение может не
    // возвращать введённое, и обновление `disabled` не должно его стирать
    const text = ref(toText(props.value));
    watch(
      () => props.value,
      (value) => {
        text.value = toText(value);
      },
    );
    const onInput = (next: string | null) => {
      text.value = next ?? '';
      const change: AnswerChange<string> = {
        value: text.value,
        complete: text.value.trim().length > 0,
      };
      emit('change', change);
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        emit('submit');
      }
    };

    return () =>
      h(VTextarea, {
        modelValue: text.value,
        'onUpdate:modelValue': onInput,
        onKeydown,
        'aria-label': props.label ?? undefined,
        rows: ROWS,
        spellcheck: false,
        disabled: props.disabled,
        style: { fontFamily: 'monospace' },
        variant: 'outlined',
        density: 'compact',
        hideDetails: true,
      });
  },
});
