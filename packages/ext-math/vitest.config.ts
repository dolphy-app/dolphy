import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'ext-math',
    include: ['test/**/*.test.ts'],
  },
});
