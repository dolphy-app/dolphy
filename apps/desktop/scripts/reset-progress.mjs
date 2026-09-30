// Сбрасывает прогресс dev-приложения:
//   pnpm dev:reset [--user-data <каталог>]
// Стирает из `<userData>/data/engine.db` журнал попыток и учебные сессии
// (`log_entry`, `log_conflict`, `imported_segment`, `study_session`): план дня
// и оценки при следующем запуске строятся заново по пустому журналу.
// Настройки, сохранённые фильтры и id устройства (`setting`, `saved_filter`,
// `meta`) остаются. Это правка БД в обход движка: журнал append-only и
// синхронизируется, поэтому сбрасывать так можно только dev-данные.
// Приложение должно быть закрыто: движок держит проекции в памяти.
import Database from 'better-sqlite3';
import { existsSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { resolveUserData } from './lib/user-data.mjs';

const PROGRESS_TABLES = [
  'log_entry',
  'log_conflict',
  'imported_segment',
  'study_session',
];

// Electron держит `SingletonLock` — симлинк `<хост>-<pid>` (macOS, Linux);
// на Windows такой проверки нет, закрыть приложение нужно самому
const runningPid = (userData) => {
  let target;
  try {
    target = readlinkSync(join(userData, 'SingletonLock'));
  } catch {
    return null;
  }
  const pid = Number(target.slice(target.lastIndexOf('-') + 1));
  if (!Number.isInteger(pid)) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch (error) {
    return error.code === 'EPERM' ? pid : null; // ESRCH — замок остался от упавшего процесса
  }
};

const userData = resolveUserData(process.argv.slice(2));
const dbPath = join(userData, 'data', 'engine.db');

if (!existsSync(dbPath)) {
  console.log(`reset: ${dbPath} does not exist, nothing to reset`);
  process.exit(0);
}
const pid = runningPid(userData);
if (pid !== null) {
  console.error(`reset: the app is running (pid ${pid}); quit it first`);
  process.exit(1);
}

const db = new Database(dbPath);
try {
  const cleared = db.transaction(() =>
    PROGRESS_TABLES.map((table) => [
      table,
      db.prepare(`DELETE FROM ${table}`).run().changes,
    ]),
  )();
  db.pragma('wal_checkpoint(TRUNCATE)');
  console.log(`reset: ${dbPath}`);
  for (const [table, count] of cleared) console.log(`reset: ${table} ${count}`);
} finally {
  db.close();
}
