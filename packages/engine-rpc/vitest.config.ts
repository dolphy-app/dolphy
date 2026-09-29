import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'engine-rpc',
    include: ['test/**/*.test.ts'],
  },
});
