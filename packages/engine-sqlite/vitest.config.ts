import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'engine-sqlite',
    include: ['test/**/*.test.ts'],
  },
});
