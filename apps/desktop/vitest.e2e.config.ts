import { defineConfig } from 'vitest/config';

// e2e в настоящем Electron: не входит в корневой `pnpm test` (проекты vitest
// берут только `apps/*/vitest.config.ts`), запускается `pnpm e2e`
export default defineConfig({
  test: {
    name: 'desktop-e2e',
    environment: 'node',
    include: ['e2e/**/*.e2e.test.ts'],
    globalSetup: ['e2e/global-setup.ts'],
    testTimeout: 180_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    maxWorkers: 1,
  },
});
