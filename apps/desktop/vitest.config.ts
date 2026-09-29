import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __LMS_SMOKE_BUILD__: false },
  test: {
    name: 'desktop',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
