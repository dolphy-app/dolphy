import { defineExtensionPanel } from '@dolphy-app/extension-sdk';

export default defineExtensionPanel({
  mount(container, ctx) {
    container.textContent = `panel ${ctx.panelId}`;
  },
});
