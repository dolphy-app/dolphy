import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'engine-contract',
    include: ['test/**/*.test.ts'],
    typecheck: {
      enabled: true,
      include: ['test/**/*.test-d.ts'],
      tsconfig: './tsconfig.vitest.json',
    },
  },
});
