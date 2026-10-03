import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { E2E_BUILD_DIR } from './support/app.ts';

/**
 * Простаивающий macOS уходит в сон циклами (Maintenance Sleep / Sleep Service
 * Back to Sleep: ~45–60 с бодрствования на ~16 минут сна), в том числе посреди
 * сценария: процессы замирают, после пробуждения таймер таймаута теста уже
 * истёк, и тест, шедший в момент сна, падает через ~16 минут по таймауту.
 * `caffeinate -i -s` держит assertions `PreventUserIdleSystemSleep` и
 * `PreventSystemSleep` (последний — только от сети), пока жив процесс vitest.
 * Других платформ и CI это не касается: e2e там не запускается.
 */
const keepAwake = () => {
  if (process.platform !== 'darwin') return () => {};
  const child = spawn('caffeinate', ['-i', '-s', '-w', String(process.pid)], {
    stdio: 'ignore',
  });
  // нет `caffeinate` — прогон возможен, просто без защиты от сна
  child.on('error', () => {});
  return () => {
    child.kill();
  };
};

/**
 * Релизная сборка в отдельный каталог: `dist` и `dist-electron` запущенного
 * `pnpm dev` не трогаем. `DOLPHY_E2E_SKIP_BUILD=1` — переиспользовать сборку.
 */
export default () => {
  const release = keepAwake();
  if (process.env.DOLPHY_E2E_SKIP_BUILD !== '1') {
    const result = spawnSync('pnpm', ['exec', 'vite', 'build'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, DOLPHY_BUILD_OUT: E2E_BUILD_DIR },
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      release();
      throw new Error('vite build for e2e failed');
    }
  }
  return release;
};
