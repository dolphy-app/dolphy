import {
  defineExtension,
  defineExtensionPanel,
  notify,
  openPanel,
} from '@dolphy-app/extension-sdk';

export const host = defineExtension({
  commands: {
    'acme.commands-panel.open': () =>
      openPanel('acme.commands-panel.main', { from: 'command' }),
    'acme.commands-panel.ping': () => notify('pong'),
  },
});

export const panels = {
  'acme.commands-panel.main': defineExtensionPanel({
    mount(container, ctx) {
      container.textContent = `panel ${ctx.panelId}`;
    },
  }),
};
