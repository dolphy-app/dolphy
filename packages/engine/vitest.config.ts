import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'engine',
    include: ['test/**/*.test.ts'],
    hookTimeout: 60_000,
    // CPU-bound сверки с Rust-дампом и симуляции (3–4 с в одиночку) не должны
    // падать по таймауту при параллельных прогонах на одной машине
    testTimeout: 30_000,
    typecheck: {
      enabled: true,
      include: ['test/**/*.test-d.ts'],
      tsconfig: './tsconfig.vitest.json',
    },
  },
});
