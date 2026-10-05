import type { StorybookConfig } from '@storybook/vue3-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.ts'],
  addons: ['@storybook/addon-docs'],
  framework: {
    name: '@storybook/vue3-vite',
    options: {
      docgen: 'vue-component-meta',
      builder: { viteConfigPath: '.storybook/vite.config.ts' },
    },
  },
  core: { disableTelemetry: true },
};

export default config;
