import { defineConfig } from 'vitest/config';

/** Бенчмарки NF1 (engine-ts-testing.md §3): в обычный `vitest run` не входят. */
export default defineConfig({
  test: {
    name: 'engine-bench',
    include: ['test/bench/**/*.bench.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    silent: false,
  },
});
