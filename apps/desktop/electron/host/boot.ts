import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createEngine } from '@spirula-app/engine/app';
import { nodeDefaults } from '@spirula-app/engine/node';
import type { EngineConfig } from '@spirula-app/engine-contract';
import { createIsomorphicGitFetcher } from '@spirula-app/engine-git';
import {
  openSqliteStorage,
  readTraneDirectory,
} from '@spirula-app/engine-sqlite';
import {
  createCatalog,
  createExtensionPolicy,
  createExtensionRegistry,
  createHostChannel,
  createRemoteExerciseTypes,
  createRemoteGradePolicies,
  discoverExtensions,
} from '@spirula-app/extension-host';
import { extensionRoots } from '../extension-roots.ts';
import { createDesktopInstaller } from './installer.ts';

export const boot = async (
  config: EngineConfig,
  /** Синхронный цикл в расширении не прервать: просим main перезапустить хост расширений. */
  restartExtHost: () => void,
) => {
  // первый запуск: каталогов ещё нет, библиотека может быть пустой
  mkdirSync(config.libraryRoot, { recursive: true });
  mkdirSync(config.dataDir, { recursive: true });
  const defaults = nodeDefaults(config); // clock, rng, ids, logger, courseSource, snapshotInstaller, memoryModel
  // журнал событий, настройки и реестр репозиториев — одна БД, одно соединение
  const {
    events: eventStore,
    settings,
    repositories: repositoryStore,
  } = openSqliteStorage({
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
  const discovery = await discoverExtensions({
    roots: extensionRoots(config),
    logger: defaults.logger,
    ...(config.appVersion ? { appVersion: config.appVersion } : {}),
  });
  // установка из каталога: отзыв читается из кэша индекса, поэтому кэш загружается до движка
  const extensionInstaller = createDesktopInstaller({
    config,
    discovery,
    logger: defaults.logger,
  });
  await extensionInstaller.ready();
  const { revocationOf } = extensionInstaller;
  // один канал к хосту расширений: виды заданий и правила оценки делят порт, дедлайны и перезапуск
  const channel = createHostChannel({
    logger: defaults.logger,
    restart: restartExtHost,
  });
  // одна политика на каталог, клиентов хоста, реестр и движок: «Настройки → Расширения» действует сразу
  const policy = createExtensionPolicy(discovery, revocationOf);
  const catalog = createCatalog(discovery.extensions, policy);
  const exerciseTypes = createRemoteExerciseTypes({
    channel,
    catalog,
    policy,
    logger: defaults.logger,
  });
  const gradePolicies = createRemoteGradePolicies({
    channel,
    catalog,
    policy,
    logger: defaults.logger,
  });
  if (__SPIRULA_SMOKE_BUILD__ && process.env.SPIRULA_SMOKE === '1') {
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
      repositoryStore,
      snapshotFetcher: createIsomorphicGitFetcher(),
      exerciseTypes,
      gradePolicies,
      extensionRegistry: createExtensionRegistry(
        discovery,
        policy,
        revocationOf,
      ),
      extensionPolicy: policy,
      extensionInstaller,
      openTraneSource: readTraneDirectory,
    },
    config,
  );
  return { engine, logger: defaults.logger, channel };
};
