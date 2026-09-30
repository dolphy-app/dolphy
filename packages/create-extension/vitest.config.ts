import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'create-extension',
    include: ['test/**/*.test.ts'],
    testTimeout: 120_000,
  },
});
