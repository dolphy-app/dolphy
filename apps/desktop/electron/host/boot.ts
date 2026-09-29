import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createEngine } from '@lms/engine/app';
import { nodeDefaults } from '@lms/engine/node';
import type { EngineConfig } from '@lms/engine-contract';
import { createSqlVerifier } from '@lms/engine-sql-runner';
import { openSqliteEventStore, readTraneDirectory } from '@lms/engine-sqlite';
import { SQL_WORKER_PATH, spawnSqlWorker } from './spawn-worker.ts';

export const boot = async (config: EngineConfig) => {
  // первый запуск: каталогов ещё нет, библиотека может быть пустой
  mkdirSync(config.libraryRoot, { recursive: true });
  mkdirSync(config.dataDir, { recursive: true });
  const defaults = nodeDefaults(config); // clock, rng, ids, logger, courseSource, settings, memoryModel
  const eventStore = openSqliteEventStore({
    path: join(config.dataDir, 'engine.db'),
    durability: config.durability ?? 'full',
  });
  const sqlVerifier = createSqlVerifier({
    source: defaults.courseSource, // fixture и expected читаются из библиотеки
    logger: defaults.logger,
    spawnWorker: spawnSqlWorker,
    workerPath: SQL_WORKER_PATH,
  });
  const engine = await createEngine(
    {
      ...defaults,
      eventStore,
      verifiers: [sqlVerifier],
      openTraneSource: readTraneDirectory,
    },
    config,
  );
  if (process.env.LMS_SMOKE === '1') {
    sqlVerifier
      .info()
      .then((info) => {
        defaults.logger.info({ ...info }, 'sql runner started');
      })
      .catch((error) => {
        defaults.logger.warn({ error }, 'sql runner did not start');
      });
  }
  return { engine, logger: defaults.logger };
};
