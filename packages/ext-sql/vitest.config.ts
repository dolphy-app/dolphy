import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'ext-sql',
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    // Vuetify imports style sheets from its modules: Vite has to process them, Node cannot
    server: { deps: { inline: ['vuetify'] } },
  },
});
