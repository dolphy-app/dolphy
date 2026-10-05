import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';

// Отдельный конфиг: основной `vite.config.ts` собирает Electron (main, preload,
// хост движка) и расширения, Storybook нужны только Vue, Vuetify и алиас `@`.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
  },
  plugins: [vue(), vuetify()],
});
