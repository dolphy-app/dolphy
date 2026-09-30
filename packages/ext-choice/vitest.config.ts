import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'ext-choice',
    include: ['test/**/*.test.ts'],
  },
});
