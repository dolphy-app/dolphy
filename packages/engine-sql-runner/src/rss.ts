import { execFile } from 'node:child_process';

/** RSS процесса в КиБ; `-1` — узнать нельзя (процесса нет, платформа без `ps`). */
export type ReadRssKb = (pid: number) => Promise<number>;

/**
 * `ps -o rss= -p <pid>` (macOS, Linux). На Windows `ps` нет: замена не
 * проверялась [НЕ ПОДТВЕРЖДЕНО], наблюдатель там ничего не видит и хост
 * пишет предупреждение при создании пула.
 */
export const readRssKbWithPs: ReadRssKb = (pid) =>
  new Promise((resolve) => {
    execFile('ps', ['-o', 'rss=', '-p', String(pid)], (error, out) => {
      const kb = Number(out.trim());
      resolve(error === null && Number.isFinite(kb) ? kb : -1);
    });
  });
