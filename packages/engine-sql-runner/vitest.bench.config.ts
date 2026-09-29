import { defineConfig } from 'vitest/config';

/** Бюджет T-44: 1 000 проверок на прогретом пуле ≤ 1 с. Блокирует релиз, в PR-CI не запускается. */
export default defineConfig({
  test: {
    name: 'bench',
    include: [],
    benchmark: { include: ['test/bench/**/*.bench.ts'] },
    testTimeout: 120_000,
  },
});
