import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'engine-sql-runner',
    include: ['test/**/*.test.ts'],
  },
});
