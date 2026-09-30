import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'extension-catalog',
    include: ['test/**/*.test.ts'],
  },
});
