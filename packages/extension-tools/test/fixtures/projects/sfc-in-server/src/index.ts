import Panel from './Panel.vue';

export const server = (s) => {
  s.registerCommand({
    id: 'acme.sfc-in-server.show',
    title: 'Show',
    run: () => Panel,
  });
};
