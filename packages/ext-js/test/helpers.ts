import { execFileSync } from 'node:child_process';

/** Живые дочерние процессы текущего процесса (по `ps`): проверка «процесс не остался». */
export const childPids = (): number[] =>
  execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter(([pid, ppid]) => ppid === process.pid && pid !== undefined)
    .map(([pid]) => pid as number)
    // сам `ps` — тоже дочерний процесс на момент снимка
    .filter((pid) => {
      try {
        const command = execFileSync(
          'ps',
          ['-p', String(pid), '-o', 'command='],
          {
            encoding: 'utf8',
          },
        );
        return command.includes('worker.');
      } catch {
        return false;
      }
    });
