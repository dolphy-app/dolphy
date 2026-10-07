import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'ext-choice',
    include: ['test/**/*.test.ts'],
    // Vuetify imports style sheets from its modules: Vite has to process them, Node cannot
    server: { deps: { inline: ['vuetify'] } },
  },
});
