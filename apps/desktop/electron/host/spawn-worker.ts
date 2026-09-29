import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { SpawnWorker } from '@lms/engine-sql-runner';

/** Собранный `sql-worker.js` лежит рядом с бандлом хоста. */
export const SQL_WORKER_PATH = fileURLToPath(
  new URL('./sql-worker.js', import.meta.url),
);

/**
 * `child_process.fork` внутри `utilityProcess`: `process.execPath` — бинарь
 * Electron, без `ELECTRON_RUN_AS_NODE` он запустил бы приложение, а не Node.
 */
export const spawnSqlWorker: SpawnWorker = (modulePath, args, options) =>
  fork(modulePath, args, {
    ...options,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
