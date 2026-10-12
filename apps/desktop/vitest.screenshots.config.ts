import { defineConfig } from 'vitest/config';

// Генератор скриншотов для README: настоящий Electron, не входит ни в `pnpm test`
// (проекты vitest берут только `apps/*/vitest.config.ts`), ни в `pnpm e2e`
// (там маска `*.e2e.test.ts`); запускается `pnpm screenshots`
export default defineConfig({
  test: {
    name: 'desktop-screenshots',
    environment: 'node',
    include: ['e2e/screenshots/**/*.screenshots.ts'],
    globalSetup: ['e2e/global-setup.ts'],
    testTimeout: 600_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    maxWorkers: 1,
  },
});
