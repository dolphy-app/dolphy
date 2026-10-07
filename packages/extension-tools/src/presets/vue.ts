import vue from '@vitejs/plugin-vue';
import type { Plugin } from 'vite';
import type { FrameworkPreset } from './index.ts';
import { vueStylesPlugin } from './vue-styles.ts';
import { vuetifyTemplatePlugin } from './vuetify-template.ts';

/**
 * `@vitejs/plugin-vue` takes "production" from `NODE_ENV` of the process, and a
 * build under `NODE_ENV=test` or `development` would write the development
 * form of the components (`__file` with a path on the build machine, a render
 * function that reads `$setup`). A bundle is always the production form.
 */
const alwaysProduction = (plugin: Plugin): Plugin => {
  const { configResolved } = plugin;
  if (typeof configResolved !== 'function') {
    throw new Error('@vitejs/plugin-vue has no configResolved hook');
  }
  plugin.configResolved = function resolved(config) {
    return configResolved.call(this, { ...config, isProduction: true });
  };
  return plugin;
};

/**
 * Vue single-file components (`.vue`): `<script setup lang="ts">`,
 * `<template>` with Vuetify components as `<v-btn>`, `<style>` and
 * `<style scoped>`. Vue and Vuetify are the window's: the bundle imports them
 * from the host, like any other client code.
 */
export const vuePreset: FrameworkPreset = {
  name: 'vue',
  extensions: ['.vue'],
  packages: ['vue', '@vue', 'vuetify', '@vuetify'],
  plugins: ({ extensionId }) => [
    // `customElement` makes a style block a string on the component (`styles`)
    // instead of a side-effect import: the build has no place for a style file
    alwaysProduction(vue({ customElement: true })),
    vuetifyTemplatePlugin(),
    vueStylesPlugin(extensionId),
  ],
};
