import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'extension-api',
    include: ['test/**/*.test.ts'],
    typecheck: {
      enabled: true,
      include: ['test/**/*.test-d.ts'],
      tsconfig: './tsconfig.vitest.json',
    },
  },
});
