import { mount } from './mount.tsx';

export const server = (s) => {
  s.registerCommand({
    id: 'acme.react-panel.ping',
    title: 'Ping',
    run: () => undefined,
  });
};

export const client = (c) => {
  c.addPanel({
    id: 'acme.react-panel.main',
    title: 'React panel',
    component: { mount },
  });
};
