import { defineConfig } from 'vitest/config';

/** Бенчмарки F-слоя (T-57): в обычный `vitest run` не входят. */
export default defineConfig({
  test: {
    name: 'engine-sqlite-bench',
    include: ['test/bench/**/*.bench.ts'],
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
    silent: false,
  },
});
