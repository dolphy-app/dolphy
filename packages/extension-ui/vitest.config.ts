import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'extension-ui',
    include: ['test/**/*.test.ts'],
    environment: 'happy-dom',
    // Vuetify imports style sheets from its modules: Vite has to process them, Node cannot
    server: { deps: { inline: ['vuetify'] } },
  },
});
