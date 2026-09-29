/**
 * Вход дочернего процесса раннера (`child_process.fork`, IPC).
 * Протокол: хост → `{ type: 'check', id, req }`; раннер → `{ type: 'ready' }`
 * один раз, затем `{ type: 'verdict', id, verdict, rssKb }` на каждый запрос.
 * Драйвер — аргумент `--driver=auto|node-sqlite|better-sqlite3`.
 *
 * Модуль без побочных импортов вне `node:*` и соседних файлов: процесс
 * запускается самим Node (type stripping), без сборки.
 */
import { runCheck } from './check.ts';
import { profileOf, resolveDriver } from './drivers.ts';
import type {
  DriverPreference,
  FromWorker,
  ToWorker,
  Verdict,
} from './types.ts';

const DRIVER_FLAG = '--driver=';
const KB = 1024;

const preferenceFromArgs = (args: readonly string[]): DriverPreference => {
  const flag = args.find((arg) => arg.startsWith(DRIVER_FLAG));
  const value = flag?.slice(DRIVER_FLAG.length);
  return value === 'node-sqlite' || value === 'better-sqlite3' ? value : 'auto';
};

const errorVerdict = (error: unknown): Verdict => ({
  status: 'error',
  code: 'internal',
  reason: error instanceof Error ? error.message : String(error),
  durationMs: 0,
  rowCount: 0,
});

const main = () => {
  if (process.send === undefined) {
    throw new Error('sql-runner worker must be started with an IPC channel');
  }
  const post = (message: FromWorker) => {
    process.send?.(message);
  };
  const driver = resolveDriver(preferenceFromArgs(process.argv.slice(2)));
  // хост умер — процесс не должен пережить его
  process.on('disconnect', () => process.exit(0));
  process.on('message', (message: ToWorker) => {
    if (message.type !== 'check') return;
    let verdict: Verdict;
    try {
      verdict = runCheck(message.req, driver);
    } catch (error) {
      verdict = errorVerdict(error);
    }
    post({
      type: 'verdict',
      id: message.id,
      verdict,
      rssKb: Math.round(process.memoryUsage.rss() / KB),
    });
  });
  post({ type: 'ready', driver, profile: profileOf(driver) });
};

main();
