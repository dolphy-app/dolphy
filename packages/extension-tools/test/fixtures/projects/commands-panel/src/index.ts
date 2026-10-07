import { defineComponent, h } from 'vue';

const main = defineComponent({
  render: () => h('p', 'PANEL_MAIN_MARKER'),
});

export const server = (s) => {
  s.registerCommand({
    id: 'acme.commands-panel.open',
    title: 'Open panel',
    category: 'Acme',
    run: () => undefined,
  });
  s.registerCommand({
    id: 'acme.commands-panel.ping',
    title: 'Ping',
    palette: false,
    run: () => undefined,
  });
};

export const client = (c) => {
  c.addPanel({
    id: 'acme.commands-panel.main',
    title: 'Acme panel',
    component: main,
  });
};
