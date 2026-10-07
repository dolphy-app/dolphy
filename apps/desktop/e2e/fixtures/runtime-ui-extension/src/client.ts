// Все поверхности расширения на компонентах Vue и Vuetify: вид ответа, панель, инъекция,
// рендерер markdown. Собирается `dolphy-ext build`: vue и vuetify берутся у приложения.
import { defineComponent, h, ref } from 'vue';
import { useTheme } from 'vuetify';
import { VAlert, VBtn, VCard, VCardText, VDialog } from 'vuetify/components';
import { anchorSelector, defineClient } from '@dolphy-app/extension-sdk';
import type { AnswerChange } from '@dolphy-app/extension-sdk';
import { usePanel } from '@dolphy-app/extension-sdk/client';

const Answer = defineComponent({
  props: ['view', 'value', 'disabled', 'verdict', 'label'],
  emits: {
    change: (_change: AnswerChange<string>) => true,
    submit: () => true,
  },
  setup(props, { emit }) {
    const theme = useTheme();
    return () =>
      h('div', { 'data-testid': 'runtimeui-answer' }, [
        h('p', { 'data-role': 'theme' }, `Тема: ${theme.name.value}`),
        h('input', {
          'aria-label': props.label,
          disabled: props.disabled,
          value: typeof props.value === 'string' ? props.value : '',
          onInput: (event: Event) => {
            const { value } = event.target as HTMLInputElement;
            emit('change', { value, complete: value.length > 0 });
          },
        }),
        h(VBtn, { onClick: () => emit('submit') }, () => 'Отправить из вида'),
      ]);
  },
});

const BoomAnswer = defineComponent({
  render() {
    throw new Error('answer boom');
  },
});

const Panel = defineComponent({
  setup() {
    const panel = usePanel();
    const theme = useTheme();
    const open = ref(false);
    return () =>
      h('div', { 'data-testid': 'runtimeui-panel' }, [
        h('p', { 'data-role': 'theme' }, `Тема: ${theme.name.value}`),
        h('p', { 'data-role': 'panel-id' }, panel.panelId),
        h(
          VAlert,
          { type: 'info', density: 'compact' },
          () => 'Панель на Vuetify',
        ),
        h(VBtn, { onClick: () => (open.value = true) }, () => 'Открыть диалог'),
        h(
          VDialog,
          {
            modelValue: open.value,
            'onUpdate:modelValue': (next: boolean) => (open.value = next),
          },
          () =>
            h(VCard, { 'data-testid': 'runtimeui-dialog' }, () => [
              h(VCardText, null, () => 'Диалог расширения'),
              h(VBtn, { onClick: () => (open.value = false) }, () => 'Закрыть'),
            ]),
        ),
      ]);
  },
});

const BoomPanel = defineComponent({
  render() {
    throw new Error('panel boom');
  },
});

const Card = defineComponent({
  setup() {
    const theme = useTheme();
    return () =>
      h('div', { 'data-testid': 'runtimeui-injection' }, [
        h('p', { 'data-role': 'theme' }, `Тема: ${theme.name.value}`),
        h(VAlert, { type: 'success', density: 'compact' }, () => 'Инъекция'),
      ]);
  },
});

const Block = defineComponent({
  props: { source: { type: String, required: true }, language: String },
  setup(props) {
    const theme = useTheme();
    return () =>
      h('div', { 'data-testid': 'runtimeui-markdown' }, [
        h('p', { 'data-role': 'theme' }, `Тема: ${theme.name.value}`),
        h(VAlert, { type: 'warning', density: 'compact' }, () =>
          props.source.trim(),
        ),
      ]);
  },
});

const Explode = defineComponent({
  props: { source: { type: String, required: true }, language: String },
  render() {
    throw new Error('markdown boom');
  },
});

export const client = defineClient((c) => {
  c.addAnswerView('acme.runtimeui.ok', Answer);
  c.addAnswerView('acme.runtimeui.boom', BoomAnswer);
  c.addPanel({
    id: 'acme.runtimeui.main',
    title: { en: 'Components', ru: 'Компоненты' },
    component: Panel,
  });
  c.addPanel({
    id: 'acme.runtimeui.boom',
    title: { en: 'Broken panel', ru: 'Сломанная панель' },
    component: BoomPanel,
  });
  c.addInjection({
    id: 'acme.runtimeui.card',
    target: anchorSelector('dailyPlan'),
    component: Card,
  });
  c.addMarkdownRenderer('runtimeui', Block);
  c.addMarkdownRenderer('explode', Explode);
});
