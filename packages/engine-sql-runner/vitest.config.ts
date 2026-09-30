import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'engine-sql-runner',
    include: ['test/**/*.test.ts'],
    // бенчи запускает только vitest.bench.config.ts (`pnpm -F @spirula/engine-sql-runner bench`)
    benchmark: { include: [] },
    // дочерние процессы раннера: порождение, kill и сборка мусора не любят перегрузки
    testTimeout: 60_000,
    hookTimeout: 30_000,
    teardownTimeout: 30_000,
  },
});
