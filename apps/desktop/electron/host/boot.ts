import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createEngine } from '@lms/engine/app';
import { nodeDefaults } from '@lms/engine/node';
import type { EngineConfig } from '@lms/engine-contract';
import { createSqlVerifier } from '@lms/engine-sql-runner';
import { openSqliteStorage, readTraneDirectory } from '@lms/engine-sqlite';
import { SQL_WORKER_PATH, spawnSqlWorker } from './spawn-worker.ts';

export const boot = async (config: EngineConfig) => {
  // первый запуск: каталогов ещё нет, библиотека может быть пустой
  mkdirSync(config.libraryRoot, { recursive: true });
  mkdirSync(config.dataDir, { recursive: true });
  const defaults = nodeDefaults(config); // clock, rng, ids, logger, courseSource, memoryModel
  // журнал событий и настройки — одна БД, одно соединение
  const { events: eventStore, settings } = openSqliteStorage({
    path: join(config.dataDir, 'engine.db'),
    durability: config.durability ?? 'full',
  });
  // прежние настройки (JSON в `dataDir/settings`) переносятся в БД один раз;
  // сбой не мешает запуску: импорт повторится, когда файлы исправят
  try {
    const report = await settings.importLegacySettings(defaults.settings);
    if (report.imported) {
      defaults.logger.info({ ...report }, 'legacy settings imported');
    }
  } catch (error) {
    defaults.logger.warn({ error }, 'legacy settings were not imported');
  }
  const sqlVerifier = createSqlVerifier({
    source: defaults.courseSource, // fixture и expected читаются из библиотеки
    logger: defaults.logger,
    spawnWorker: spawnSqlWorker,
    workerPath: SQL_WORKER_PATH,
  });
  const engine = await createEngine(
    {
      ...defaults,
      settings,
      eventStore,
      verifiers: [sqlVerifier],
      openTraneSource: readTraneDirectory,
    },
    config,
  );
  if (__LMS_SMOKE_BUILD__ && process.env.LMS_SMOKE === '1') {
    sqlVerifier
      .info()
      .then((info) => {
        defaults.logger.info(
          { ...info, worker: SQL_WORKER_PATH },
          'sql runner started',
        );
      })
      .catch((error) => {
        defaults.logger.warn({ error }, 'sql runner did not start');
      });
  }
  return { engine, logger: defaults.logger };
};
