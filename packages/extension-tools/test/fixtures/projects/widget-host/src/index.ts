import { defineComponent, h } from 'vue';
import 'vuetify/styles';
import { VAlert } from 'vuetify/components';

const card = defineComponent({
  render: () => h(VAlert, { type: 'info' }, () => 'WIDGET_ALERT'),
});

export const client = (c) => {
  c.addInjection({
    id: 'acme.widget-host.card',
    target: '[data-ext-anchor="dailyPlan"]',
    component: card,
  });
};
