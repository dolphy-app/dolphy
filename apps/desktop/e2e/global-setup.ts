import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { E2E_BUILD_DIR } from './support/app.ts';

/**
 * Релизная сборка в отдельный каталог: `dist` и `dist-electron` запущенного
 * `pnpm dev` не трогаем. `LMS_E2E_SKIP_BUILD=1` — переиспользовать сборку.
 */
export default () => {
  if (process.env.LMS_E2E_SKIP_BUILD === '1') return;
  const result = spawnSync('pnpm', ['exec', 'vite', 'build'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, LMS_BUILD_OUT: E2E_BUILD_DIR },
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error('vite build for e2e failed');
};
