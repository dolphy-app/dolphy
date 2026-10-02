import { defineMarkdownRenderer } from '@dolphy-app/extension-sdk';

export const markdown = {
  chart: defineMarkdownRenderer((source, container) => {
    container.textContent = source;
  }),
};
