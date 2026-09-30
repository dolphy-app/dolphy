import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'extension-sdk',
    include: ['test/**/*.test.ts'],
    environment: 'happy-dom',
  },
});
