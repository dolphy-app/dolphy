import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'engine',
    include: ['test/**/*.test.ts'],
    hookTimeout: 60_000,
    typecheck: {
      enabled: true,
      include: ['test/**/*.test-d.ts'],
      tsconfig: './tsconfig.vitest.json',
    },
  },
});
