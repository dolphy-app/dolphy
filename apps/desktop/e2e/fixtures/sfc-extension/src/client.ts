// Панель и вставка на однофайловых компонентах Vue с компонентами Vuetify в шаблоне.
// Собирается `dolphy-ext build` с пресетом `vue`: vue и vuetify берутся у приложения.
import { anchorSelector, defineClient } from '@dolphy-app/extension-sdk';
import Card from './Card.vue';
import Panel from './Panel.vue';

export const client = defineClient((c) => {
  c.addPanel({
    id: 'acme.sfc.main',
    title: { en: 'SFC panel', ru: 'SFC-панель' },
    component: Panel,
  });
  c.addInjection({
    id: 'acme.sfc.card',
    target: anchorSelector('dailyPlan'),
    component: Card,
  });
});
