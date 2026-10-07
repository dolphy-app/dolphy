// Виджеты для e2e: карточка с курсом, темой и счётчиком, короткий и длинный.
// Собирается `dolphy-ext build`: vue и vuetify берутся у приложения.
import { defineComponent, h, ref } from 'vue';
import { useTheme } from 'vuetify';
import { VAlert, VBtn } from 'vuetify/components';
import {
  defineExtension,
  defineExtensionPanel,
  defineExtensionWidget,
} from '@dolphy-app/extension-sdk';
import { usePanel, useWidget } from '@dolphy-app/extension-sdk/client';

const VERSION = '1.0.0';

export const host = defineExtension({
  activate(ctx) {
    ctx.commands.register('acme.widgets.open', () => ({
      openPanel: 'acme.widgets.main',
    }));
    ctx.commands.register('acme.widgets.count', async () => {
      const count = ((await ctx.storage.get('count')) ?? 0) + 1;
      await ctx.storage.set('count', count);
      return { count };
    });
    ctx.commands.register('acme.widgets.plain', () => undefined);
  },
});

const Course = defineComponent({
  setup() {
    const panel = usePanel();
    return () =>
      h(
        'p',
        { 'data-role': 'course' },
        `Курс: ${panel.context.courseId ?? 'все'}`,
      );
  },
});

export const panels = {
  'acme.widgets.main': defineExtensionPanel(Course),
};

const Card = defineComponent({
  setup() {
    const widget = useWidget<string>();
    const theme = useTheme();
    const result = ref('');
    const attempt = async (command: string) => {
      try {
        const value = await widget.call(command);
        result.value = `ok ${JSON.stringify(value ?? null)}`;
      } catch (error) {
        result.value = `Ошибка: ${error instanceof Error ? error.message : String(error)}`;
      }
    };
    return () =>
      h('div', [
        h('p', { 'data-role': 'version' }, `Карточка v${VERSION}`),
        h(
          'p',
          { 'data-role': 'course' },
          `Курс: ${widget.context.courseId ?? 'все'}`,
        ),
        h('p', { 'data-role': 'theme' }, `Тема: ${theme.name.value}`),
        h('p', { 'data-role': 'result' }, result.value),
        h(
          VBtn,
          { onClick: () => attempt('acme.widgets.count') },
          () => 'Прибавить',
        ),
        h(
          VBtn,
          { onClick: () => attempt('acme.victim.mark') },
          () => 'Чужая команда',
        ),
      ]);
  },
});

const Short = defineComponent({
  render: () =>
    h(VAlert, { type: 'info', density: 'compact' }, () => 'Коротко'),
});

const Tall = defineComponent({
  render: () =>
    h(
      'div',
      { 'data-role': 'tall', style: { height: '600px' } },
      'Длинное содержимое',
    ),
});

export const widgets = {
  'acme.widgets.card': defineExtensionWidget(Card),
  'acme.widgets.short': defineExtensionWidget(Short),
  'acme.widgets.tall': defineExtensionWidget(Tall),
};
