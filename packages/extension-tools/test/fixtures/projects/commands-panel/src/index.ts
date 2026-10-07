import {
  defineExtension,
  defineExtensionPanel,
  notify,
  openPanel,
} from '@dolphy-app/extension-sdk';
import { usePanel } from '@dolphy-app/extension-sdk/client';
import { defineComponent, h } from 'vue';

export const host = defineExtension({
  commands: {
    'acme.commands-panel.open': () =>
      openPanel('acme.commands-panel.main', { from: 'command' }),
    'acme.commands-panel.ping': () => notify('pong'),
  },
});

export const panels = {
  'acme.commands-panel.main': defineExtensionPanel(
    defineComponent({
      setup() {
        const panel = usePanel();
        return () => h('p', `panel ${panel.panelId}`);
      },
    }),
  ),
};
