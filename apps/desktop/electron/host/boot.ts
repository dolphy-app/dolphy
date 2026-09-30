import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createEngine } from '@lms/engine/app';
import { nodeDefaults } from '@lms/engine/node';
import type { EngineConfig } from '@lms/engine-contract';
import { openSqliteStorage, readTraneDirectory } from '@lms/engine-sqlite';
import {
  createCatalog,
  createRemoteExerciseTypes,
  discoverExtensions,
} from '@lms/extension-host';
import { extensionRoots } from '../extension-roots.ts';

export const boot = async (
  config: EngineConfig,
  /** Синхронный цикл в расширении не прервать: просим main перезапустить хост расширений. */
  restartExtHost: () => void,
) => {
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
  // расширения: манифесты читаем здесь (без запуска кода), код исполняется в хосте расширений
  const { extensions } = await discoverExtensions({
    roots: extensionRoots(config),
    logger: defaults.logger,
  });
  const exerciseTypes = createRemoteExerciseTypes({
    catalog: createCatalog(extensions),
    logger: defaults.logger,
    restart: restartExtHost,
  });
  if (__LMS_SMOKE_BUILD__ && process.env.LMS_SMOKE === '1') {
    defaults.logger.info(
      { types: exerciseTypes.list().map(({ type }) => type) },
      'exercise types discovered',
    );
  }
  const engine = await createEngine(
    {
      ...defaults,
      settings,
      eventStore,
      exerciseTypes,
      openTraneSource: readTraneDirectory,
    },
    config,
  );
  return { engine, logger: defaults.logger, exerciseTypes };
};
