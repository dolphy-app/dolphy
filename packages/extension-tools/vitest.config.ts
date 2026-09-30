import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'extension-tools',
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
