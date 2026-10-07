import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createEngine, createExtensionHealth } from '@dolphy-app/engine/app';
import type {
  ExtensionHostServices,
  HostedEngine,
} from '@dolphy-app/engine/app';
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
  createRemoteExtensionHooks,
  createRemoteExtensionRpc,
  createRemoteExtensionTransfers,
  createRemoteGradePolicies,
  discoverExtensions,
} from '@dolphy-app/extension-host';
import type { HostChannel } from '@dolphy-app/extension-host';
import { extensionRoots } from '../extension-roots.ts';
import { createDesktopInstaller } from './installer.ts';
import { createOffsetClock } from './schedule-clock.ts';

/** Сколько запуск ждёт первую регистрацию вкладов от хоста расширений. */
const FIRST_REGISTRATION_TIMEOUT_MS = 15_000;

export const boot = async (
  config: EngineConfig,
  /** Синхронный цикл в расширении не прервать: просим main перезапустить хост расширений. */
  restartExtHost: () => void,
  /** Пользователь просит запустить хост расширений после `gave-up`: main сбрасывает счётчик падений. */
  resetExtHost: () => void,
  /** Возможности main (шифр секретов): запросы уходят по `parentPort`. */
  platform: PlatformServices,
  /** Канал создан: main может соединить его с хостом расширений, до этого регистраций не будет. */
  onChannelReady: (channel: HostChannel) => void,
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
  // один изменяемый снимок на политику, каталог, реестр и установщик: `reload` меняет его целиком;
  // вклады приходят позже, из регистраций хоста расширений
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
  // хост расширений сам расширения не ищет: после каждого подключения канал отправляет ему текущих кандидатов
  // и отдаёт регистрации сюда; первая открывает запуск, следующие (перезапуск хоста) обновляют вклады у живого движка
  const live: { engine?: HostedEngine } = {};
  let hostServices: ExtensionHostServices | undefined;
  // `server` читает настройки при регистрации, когда снимок движка ещё без её определений: сохранённые значения догоняют расширение сообщениями
  const pushSettingValues = async (target: HostChannel): Promise<void> => {
    for (const { id, settings } of discovery.get().extensions) {
      if (hostServices === undefined || settings.length === 0) continue;
      const values = await hostServices.settings.all(id);
      for (const [settingId, value] of Object.entries(values)) {
        if (
          typeof value === 'boolean' ||
          typeof value === 'string' ||
          typeof value === 'number' ||
          (Array.isArray(value) &&
            value.every((item) => typeof item === 'string'))
        ) {
          target.notify({
            method: 'settingChanged',
            params: { extensionId: id, id: settingId, value },
          });
        }
      }
    }
  };
  let firstRegistration!: () => void;
  const registered = new Promise<void>((resolve) => {
    firstRegistration = resolve;
  });
  const channel = createHostChannel({
    logger: defaults.logger,
    restart: restartExtHost,
    currentExtensions: () => discovery.get().candidates,
    onRegistrations: (result) => {
      const changed = discovery.applyRegistrations(result);
      firstRegistration();
      if (!changed) return;
      live.engine?.notifyExtensionsChanged();
      void pushSettingValues(channel).catch((error) =>
        defaults.logger.warn({ error }, 'setting values were not delivered'),
      );
    },
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
    logger: defaults.logger,
    health,
  });
  const gradePolicies = createRemoteGradePolicies({
    channel,
    catalog,
    logger: defaults.logger,
  });
  const extensionCommands = createRemoteExtensionCommands({
    channel,
    logger: defaults.logger,
  });
  const extensionHooks = createRemoteExtensionHooks({
    channel,
    discovery,
    policy,
    logger: defaults.logger,
    health,
  });
  const extensionRpc = createRemoteExtensionRpc({
    channel,
    logger: defaults.logger,
  });
  const extensionTransfers = createRemoteExtensionTransfers({
    channel,
    logger: defaults.logger,
  });
  // порядок запуска: сервисы данных расширений начинают отвечать хосту → хост расширений подключается и регистрирует
  // вклады (`server` читает хранилище и настройки) → только потом открывается библиотека, уже с видами заданий;
  // хост не ответил за срок — пустой реестр, дальше обычный путь `reload` → `generation` → `contributions-changed`
  const beforeLibrary = async (host: ExtensionHostServices): Promise<void> => {
    hostServices = host;
    channel.serve(host);
    onChannelReady(channel);
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(
        () => resolve('timeout'),
        FIRST_REGISTRATION_TIMEOUT_MS,
      );
    });
    if ((await Promise.race([registered, timedOut])) === 'timeout') {
      defaults.logger.warn(
        { timeoutMs: FIRST_REGISTRATION_TIMEOUT_MS },
        'extension host did not register contributions in time, starting without them',
      );
    }
    clearTimeout(timer);
  };
  const engine = await createEngine(
    {
      ...defaults,
      beforeLibrary,
      settings,
      eventStore,
      repositoryStore,
      extensionDataStore,
      platform,
      snapshotFetcher: createIsomorphicGitFetcher(),
      exerciseTypes,
      gradePolicies,
      extensionCommands,
      extensionRpc,
      extensionHooks,
      extensionTransfers,
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
  live.engine = engine;
  if (__DOLPHY_SMOKE_BUILD__ && process.env.DOLPHY_SMOKE === '1') {
    defaults.logger.info(
      { types: exerciseTypes.list().map(({ type }) => type) },
      'exercise types discovered',
    );
  }
  // хост расширений получает данные расширений, изменения настроек и события обучения;
  // отключать не нужно: закрытие движка закрывает канал и снимает подписки
  connectEngine({
    channel,
    engine,
    discovery,
    policy,
    logger: defaults.logger,
    health,
    schedule: {
      ...(config.scheduleTickMs !== undefined && {
        tickMs: config.scheduleTickMs,
      }),
      ...(config.scheduleClockOffsetFile !== undefined && {
        now: createOffsetClock(config.scheduleClockOffsetFile),
      }),
    },
  });
  return { engine, logger: defaults.logger, channel, health };
};
