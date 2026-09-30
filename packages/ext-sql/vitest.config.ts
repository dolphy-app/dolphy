import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'ext-sql',
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
