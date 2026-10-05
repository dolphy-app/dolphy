/** Вид ввода ответа `dolphy.sql`: многострочное моноширинное поле Vuetify в теневом корне элемента. */
import type { MountAnswerView } from '@dolphy-app/extension-sdk';
import { mountTextarea } from '@dolphy-app/extension-ui/vuetify/fields';

const ROWS = 6;

const toText = (value: unknown) => (typeof value === 'string' ? value : '');

export const mountSqlEditor: MountAnswerView = (api, initial) => {
  const container = document.createElement('div');
  api.root.append(container);

  // значение свойства применяется только при его смене: приложение может не
  // возвращать введённый текст, и обновление `disabled` не должно его стирать
  const state = { value: initial.value };
  const field = mountTextarea(container, {
    value: toText(initial.value),
    label: api.label,
    rows: ROWS,
    monospace: true,
    spellcheck: false,
    disabled: initial.disabled,
    onChange: (text) => {
      api.setAnswer(text, text.trim().length > 0);
    },
    onSubmit: api.submit,
  });

  return {
    update: (props) => {
      if (props.value !== state.value) {
        state.value = props.value;
        field.update({ value: toText(props.value) });
      }
      field.update({ disabled: props.disabled });
    },
    destroy: field.destroy,
  };
};
