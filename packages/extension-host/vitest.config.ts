import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'extension-host',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
