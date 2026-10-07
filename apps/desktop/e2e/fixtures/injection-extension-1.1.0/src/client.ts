// Инъекции для e2e: карточка, короткая и длинная вставки по якорю «Плана на сегодня»,
// вставка по произвольному селектору (пункты боковых панелей) и сломанная вставка.
// Собирается `dolphy-ext build`: vue и vuetify берутся у приложения.
import { defineComponent, h, ref } from 'vue';
import { useTheme } from 'vuetify';
import { VAlert, VBtn } from 'vuetify/components';
import { anchorSelector, defineClient } from '@dolphy-app/extension-sdk';
import { useInjection, usePanel } from '@dolphy-app/extension-sdk/client';

const VERSION = '1.1.0';

const Course = defineComponent({
  setup() {
    const panel = usePanel();
    const result = ref('');
    const attempt = async (command: string) => {
      try {
        const value = await panel.call(command);
        result.value = `ok ${JSON.stringify(value ?? null)}`;
      } catch (error) {
        result.value = `Ошибка: ${error instanceof Error ? error.message : String(error)}`;
      }
    };
    return () =>
      h('div', [
        h(
          'p',
          { 'data-role': 'course' },
          `Курс: ${panel.context.courseId ?? 'все'}`,
        ),
        h('p', { 'data-role': 'result' }, result.value),
        h(
          VBtn,
          { onClick: () => attempt('acme.injection.count') },
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

const Card = defineComponent({
  setup() {
    const injection = useInjection();
    const theme = useTheme();
    return () =>
      h('div', { 'data-testid': 'injection-card' }, [
        h('p', { 'data-role': 'version' }, `Карточка v${VERSION}`),
        h('p', { 'data-role': 'theme' }, `Тема: ${theme.name.value}`),
        h('p', { 'data-role': 'position' }, injection.position),
        h('p', { 'data-role': 'target' }, injection.target.tagName),
        h(VBtn, null, () => 'Кнопка карточки'),
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

const NavNote = defineComponent({
  render: () => h('p', { 'data-role': 'nav-note' }, 'Заметка у меню'),
});

const Boom = defineComponent({
  render() {
    throw new Error('injection boom');
  },
});

export const client = defineClient((c) => {
  c.addPanel({
    id: 'acme.injection.main',
    title: { en: 'Injection panel', ru: 'Панель инъекций' },
    icon: 'trophy',
    component: Course,
  });
  c.addInjection({
    id: 'acme.injection.card',
    target: anchorSelector('dailyPlan'),
    component: Card,
  });
  c.addInjection({
    id: 'acme.injection.short',
    target: anchorSelector('dailyPlan'),
    position: 'prepend',
    component: Short,
  });
  c.addInjection({
    id: 'acme.injection.tall',
    target: anchorSelector('dailyPlan'),
    position: 'after',
    component: Tall,
  });
  c.addInjection({
    id: 'acme.injection.nav',
    target: '[data-testid="extension-nav"]',
    position: 'after',
    component: NavNote,
  });
  c.addInjection({
    id: 'acme.injection.boom',
    target: anchorSelector('dailyPlan'),
    component: Boom,
  });
});
