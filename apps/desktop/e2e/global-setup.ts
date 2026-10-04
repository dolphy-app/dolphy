import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_BUILD_DIR, E2E_SHOW, QUIET_ELECTRON_APP } from './support/app.ts';

const APP_DIR = fileURLToPath(new URL('..', import.meta.url));

const run = (command: string, args: string[]) => {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
};

/**
 * macOS: копия `Electron.app` с `LSUIElement=true` для `launchApp`. Клон APFS
 * (`cp -c`) почти бесплатен; подпись нужна заново (ad-hoc), иначе ядро не
 * запустит изменённый бандл.
 */
const prepareQuietElectron = () => {
  const binary = createRequire(import.meta.url)('electron') as string;
  const source = binary.slice(0, binary.indexOf('.app/') + '.app'.length);
  rmSync(QUIET_ELECTRON_APP, { recursive: true, force: true });
  run('cp', ['-cR', source, QUIET_ELECTRON_APP]);
  run('/usr/libexec/PlistBuddy', [
    '-c',
    'Add :LSUIElement bool true',
    join(QUIET_ELECTRON_APP, 'Contents/Info.plist'),
  ]);
  run('codesign', ['--force', '--deep', '-s', '-', QUIET_ELECTRON_APP]);
};

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
 * `DOLPHY_E2E_SHOW=1` — обычный Electron, окна видны без фокуса (на space yabai).
 */
export default () => {
  const release = keepAwake();
  if (process.env.DOLPHY_E2E_SKIP_BUILD !== '1') {
    const result = spawnSync('pnpm', ['exec', 'vite', 'build'], {
      cwd: APP_DIR,
      env: { ...process.env, DOLPHY_BUILD_OUT: E2E_BUILD_DIR },
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      release();
      throw new Error('vite build for e2e failed');
    }
  }
  if (process.platform === 'darwin' && !E2E_SHOW) prepareQuietElectron();
  return release;
};
