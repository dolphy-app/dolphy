import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createEngine, createExtensionHealth } from '@dolphy-app/engine/app';
import { nodeDefaults } from '@dolphy-app/engine/node';
import type { PlatformServices } from '@dolphy-app/engine/ports';
import type { EngineConfig } from '@dolphy-app/engine-contract';
import { createIsomorphicGitFetcher } from '@dolphy-app/engine-git';
import {
  openSqliteStorage,
  readTraneDirectory,
} from '@dolphy-app/engine-sqlite';
import {
  createCatalog,
  createDiscoveryHolder,
  createExtensionPolicy,
  createExtensionRegistry,
  createExtensionReloader,
  connectEngine,
  createHostChannel,
  createRemoteExerciseTypes,
  createRemoteExtensionCommands,
  createRemoteGradePolicies,
  discoverExtensions,
} from '@dolphy-app/extension-host';
import { extensionRoots } from '../extension-roots.ts';
import { createDesktopInstaller } from './installer.ts';

export const boot = async (
  config: EngineConfig,
  /** Синхронный цикл в расширении не прервать: просим main перезапустить хост расширений. */
  restartExtHost: () => void,
  /** Пользователь просит запустить хост расширений после `gave-up`: main сбрасывает счётчик падений. */
  resetExtHost: () => void,
  /** Возможности main (шифр секретов): запросы уходят по `parentPort`. */
  platform: PlatformServices,
) => {
  // первый запуск: каталогов ещё нет, библиотека может быть пустой
  mkdirSync(config.libraryRoot, { recursive: true });
  mkdirSync(config.dataDir, { recursive: true });
  const defaults = nodeDefaults(config); // clock, rng, ids, logger, courseSource, snapshotInstaller, memoryModel
  // журнал событий, настройки, реестр репозиториев и данные расширений — одна БД, одно соединение
  const {
    events: eventStore,
    settings,
    repositories: repositoryStore,
    extensionData: extensionDataStore,
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
  const discover = () =>
    discoverExtensions({
      roots: extensionRoots(config),
      logger: defaults.logger,
      ...(config.appVersion ? { appVersion: config.appVersion } : {}),
    });
  // один изменяемый снимок на политику, каталог, реестр и установщик: `reload` меняет его целиком
  const discovery = createDiscoveryHolder(await discover());
  // установка из каталога: отзыв читается из кэша индекса, поэтому кэш загружается до движка
  const extensionInstaller = createDesktopInstaller({
    config,
    settingUrl: (await settings.loadExtensions()).catalogUrl,
    discovery,
    logger: defaults.logger,
  });
  await extensionInstaller.ready();
  const { revocationOf } = extensionInstaller;
  // один канал к хосту расширений: виды заданий и правила оценки делят порт, дедлайны и перезапуск;
  // хост расширений сам расширения не ищет: после каждого подключения ему уходит текущий набор
  const channel = createHostChannel({
    logger: defaults.logger,
    restart: restartExtHost,
    currentExtensions: () => discovery.get().extensions,
  });
  // одна политика на каталог, клиентов хоста, реестр и движок: «Настройки → Расширения» действует сразу
  // безопасный режим, заданный запуском, действует поверх настройки
  const policy = createExtensionPolicy(
    discovery,
    revocationOf,
    config.forceSafeMode !== undefined,
  );
  // здоровье расширений копится в памяти движка; клиенты хоста пишут сбои сюда же
  const health = createExtensionHealth(defaults.clock);
  const catalog = createCatalog(discovery, policy);
  const exerciseTypes = createRemoteExerciseTypes({
    channel,
    catalog,
    policy,
    logger: defaults.logger,
    health,
  });
  const gradePolicies = createRemoteGradePolicies({
    channel,
    catalog,
    policy,
    logger: defaults.logger,
  });
  const extensionCommands = createRemoteExtensionCommands({
    channel,
    discovery,
    policy,
    logger: defaults.logger,
  });
  if (__DOLPHY_SMOKE_BUILD__ && process.env.DOLPHY_SMOKE === '1') {
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
      extensionDataStore,
      platform,
      snapshotFetcher: createIsomorphicGitFetcher(),
      exerciseTypes,
      gradePolicies,
      extensionCommands,
      extensionRegistry: createExtensionRegistry(
        discovery,
        policy,
        revocationOf,
      ),
      extensionPolicy: policy,
      extensionHealth: health,
      extensionHostControl: { restart: resetExtHost },
      extensionInstaller,
      extensionReloader: createExtensionReloader({
        holder: discovery,
        discover,
        channel,
        logger: defaults.logger,
      }),
      openTraneSource: readTraneDirectory,
    },
    config,
  );
  // хост расширений получает данные расширений, изменения настроек и события обучения;
  // отключать не нужно: закрытие движка закрывает канал и снимает подписки
  connectEngine({
    channel,
    engine,
    discovery,
    policy,
    logger: defaults.logger,
    health,
  });
  return { engine, logger: defaults.logger, channel, health };
};
