import { dependencyStylesPlugin } from '@dolphy-app/extension-tools/dependency-styles';
import type { StorybookConfig } from '@storybook/html-vite';
import { mergeConfig } from 'vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.ts'],
  addons: ['@storybook/addon-docs'],
  framework: '@storybook/html-vite',
  core: { disableTelemetry: true },
  // как в `dolphy-ext build`: стили Vuetify собираются в реестр, а набор кладёт их в теневой корень вида
  viteFinal: (viteConfig) =>
    mergeConfig(viteConfig, { plugins: [dependencyStylesPlugin()] }),
};

export default config;
