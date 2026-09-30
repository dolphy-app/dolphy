// Каталог userData dev-запуска Electron (`pnpm dev`): библиотека курсов лежит
// в `<userData>/library`, журнал и настройки — в `<userData>/data/engine.db`
// (см. electron/main/index.ts). Имя приложения Electron берёт из
// package.json (`productName`, иначе `name`). Упакованное приложение
// называется по `productName` electron-builder, его каталог указывают
// явно: `--user-data <каталог>`.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const manifest = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);

const appDataDir = () => {
  switch (process.platform) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support');
    case 'win32':
      return process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    default:
      return process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  }
};

export const resolveUserData = (argv) => {
  const index = argv.indexOf('--user-data');
  if (index === -1) {
    return join(appDataDir(), manifest.productName ?? manifest.name);
  }
  const value = argv[index + 1];
  if (!value) throw new Error('--user-data requires a directory');
  return resolve(value);
};
