// Все поверхности расширения на компонентах Vue и Vuetify: вид ответа, панель, виджет,
// рендерер markdown. Собирается `dolphy-ext build`: vue и vuetify берутся у приложения.
import { defineComponent, h, ref } from 'vue';
import { useTheme } from 'vuetify';
import { VAlert, VBtn, VCard, VCardText, VDialog } from 'vuetify/components';
import {
  defineAnswerView,
  defineExtension,
  defineExtensionPanel,
  defineExtensionWidget,
  defineMarkdownRenderer,
} from '@dolphy-app/extension-sdk';
import type { AnswerChange } from '@dolphy-app/extension-sdk';
import { usePanel } from '@dolphy-app/extension-sdk/client';

const handler = {
  project: () => ({}),
  grade: () => ({ outcome: 'passed' as const }),
};

export const host = defineExtension({
  exerciseTypes: {
    'acme.runtimeui.ok': handler,
    'acme.runtimeui.boom': handler,
  },
});

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
      h('div', { 'data-testid': 'runtimeui-widget' }, [
        h('p', { 'data-role': 'theme' }, `Тема: ${theme.name.value}`),
        h(VAlert, { type: 'success', density: 'compact' }, () => 'Виджет'),
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

export const views = {
  'acme.runtimeui.ok': defineAnswerView(Answer),
  'acme.runtimeui.boom': defineAnswerView(BoomAnswer),
};

export const panels = {
  'acme.runtimeui.main': defineExtensionPanel(Panel),
  'acme.runtimeui.boom': defineExtensionPanel(BoomPanel),
};

export const widgets = {
  'acme.runtimeui.card': defineExtensionWidget(Card),
};

export const markdown = {
  runtimeui: defineMarkdownRenderer(Block),
  explode: defineMarkdownRenderer(Explode),
};
