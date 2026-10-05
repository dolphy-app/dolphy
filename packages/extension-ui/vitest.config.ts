import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'extension-ui',
    include: ['test/**/*.test.ts'],
    environment: 'happy-dom',
  },
});
