import Panel from './Panel.vue';

export const server = (s) => {
  s.registerCommand({
    id: 'acme.sfc-panel.ping',
    title: 'Ping',
    run: () => undefined,
  });
};

export const client = (c) => {
  c.addPanel({
    id: 'acme.sfc-panel.main',
    title: 'SFC panel',
    component: Panel,
  });
};
