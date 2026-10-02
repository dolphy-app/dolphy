import {
  defineExtension,
  notify,
  openPanel,
} from '@dolphy-app/extension-sdk';

export default defineExtension({
  commands: {
    'acme.commands-panel.open': () =>
      openPanel('acme.commands-panel.main', { from: 'command' }),
    'acme.commands-panel.ping': () => notify('pong'),
  },
});
