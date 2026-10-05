import { defineConfig } from 'vitest/config';

// Локально vitest по умолчанию берёт почти все ядра: два параллельных
// `pnpm test` (например, в разных worktree) поднимают load average за 100, и
// тесты с пределом 5 с падают по таймауту. В CI ядер мало — там остаётся
// значение по умолчанию. Переопределить: `VITEST_MAX_WORKERS=<n> pnpm test`.
const LOCAL_MAX_WORKERS = 6;

export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts'],
    ...(process.env.CI || process.env.VITEST_MAX_WORKERS
      ? {}
      : { maxWorkers: LOCAL_MAX_WORKERS }),
  },
});
