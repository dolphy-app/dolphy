/**
 * Протокол IPC родитель ↔ дочерний процесс проверки.
 * Дочерний → `{ type: 'ready' }` один раз, родитель → `{ type: 'run', request }`,
 * дочерний → `{ type: 'result', result }` и выход.
 */
import type { RunRequest, RunResult } from './run-checks.ts';

export type ToWorker = { type: 'run'; request: RunRequest };

export type FromWorker =
  { type: 'ready' } | { type: 'result'; result: RunResult };
