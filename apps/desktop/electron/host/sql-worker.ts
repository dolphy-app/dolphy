// Вход дочернего процесса раннера SQL: код и протокол — в пакете раннера.
// Процесс запускается `child_process.fork` из хоста с ELECTRON_RUN_AS_NODE=1.
import '@lms/engine-sql-runner/worker';
