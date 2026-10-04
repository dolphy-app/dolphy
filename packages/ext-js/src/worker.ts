/**
 * Вход дочернего процесса проверки (`child_process.fork`, IPC): один процесс —
 * одна проверка. Процесс запускается с режимом разрешений Node без грантов:
 * читает только собственные файлы, не порождает процессы и не грузит аддоны.
 */
import { runChecks } from './run-checks.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

const main = () => {
  if (process.send === undefined) {
    throw new Error('dolphy.js worker must be started with an IPC channel');
  }
  const post = (message: FromWorker, done: () => void = () => {}) => {
    process.send?.(message, done);
  };
  // родитель умер — процесс не должен его пережить
  process.on('disconnect', () => process.exit(0));
  process.on('message', (message: ToWorker) => {
    if (message.type !== 'run') return;
    runChecks(message.request).then(
      (result) => post({ type: 'result', result }, () => process.exit(0)),
      (error: unknown) => {
        console.error(error);
        process.exit(1);
      },
    );
  });
  post({ type: 'ready' });
};

main();
