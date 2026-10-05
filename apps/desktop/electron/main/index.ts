import {
  BrowserWindow,
  MessageChannelMain,
  Notification,
  app,
  clipboard,
  dialog,
  ipcMain,
  net,
  protocol,
  safeStorage,
  session,
  shell,
  utilityProcess,
} from 'electron';
import { appendFileSync, existsSync, watch } from 'node:fs';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { ExtensionHostStatusDto } from '@dolphy-app/engine-contract';
import { createExtSupervisor, isTypedMessage } from './ext-supervisor.ts';
import {
  createFakeFileDialogs,
  fakeFileDialogsOf,
} from './fake-file-dialogs.ts';
import { createHostLink } from './host-link.ts';
import { createLogFile, createProcessOutput } from './log-file.ts';
import { createMainLogger } from './logger.ts';
import {
  createPlatformServices,
  fakeSafeStorageOf,
  notificationLogOf,
} from './platform-services.ts';
import { safeModeSource } from './safe-mode.ts';
import { scheduleClockOf } from './schedule-clock.ts';
import { createDevExtensionsShell } from './shells/dev-extensions.ts';
import { createDeepLinkShell } from './shells/deep-link.ts';
import { createDevToolsShortcutShell } from './shells/devtools-shortcut.ts';
import { createEngineShell } from './shells/engine.ts';
import { createExtensionAssetsShell } from './shells/extension-assets.ts';
import { createLifecycleShell } from './shells/lifecycle.ts';
import { createPlatformShell } from './shells/platform.ts';
import { createSmokeShell } from './shells/smoke.ts';
import { createWebContentsGuardShell } from './shells/web-contents-guard.ts';
import { createWindowShell } from './shells/window.ts';
import { createSupervisor } from './supervisor.ts';
import type { HostProcessLike } from './supervisor.ts';
import { SMOKE_ARGUMENT } from '../../shared/smoke.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// dist-electron/{main,preload,host}/ и dist/index.html (renderer)
const APP_ROOT = path.join(__dirname, '../..');
const RENDERER_DIST = path.join(APP_ROOT, 'dist');
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

// смоук существует только в смоук-сборке (DOLPHY_SMOKE_BUILD=1 при vite build):
// в релизном бандле флаг — false, весь код за ним вырезан
const smoke = __DOLPHY_SMOKE_BUILD__ && process.env.DOLPHY_SMOKE === '1';
const smokeUserData = __DOLPHY_SMOKE_BUILD__
  ? process.env.DOLPHY_SMOKE_USER_DATA
  : undefined;
if (smoke && smokeUserData) app.setPath('userData', smokeUserData);

// e2e: окно не показывается и не забирает фокус у приложения пользователя
// (редактор, оконный менеджер); только в неупакованном приложении
const hiddenWindow =
  smoke || (!app.isPackaged && process.env.DOLPHY_HIDDEN_WINDOW === '1');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const userData = app.getPath('userData');
// файловый журнал: main пишет сам и принимает stderr процессов движка и хоста расширений
const logsDir = path.join(userData, 'logs');
const logFile = createLogFile({
  dir: logsDir,
  clock: { now: () => Date.now() },
  onError: (error) => console.error({ error }, 'log file write failed'),
});
const logger = createMainLogger(logFile);
const outputOf = (source: 'engine' | 'ext-host') => () =>
  createProcessOutput({
    source,
    file: logFile,
    mirror: { stdout: process.stdout, stderr: process.stderr },
  });
const libraryRoot =
  (smoke && process.env.DOLPHY_SMOKE_LIBRARY) || path.join(userData, 'library');
// расширения из поставки (read-only) и пользовательские; пользовательское с тем же id побеждает
const bundledExtensionsDir = app.isPackaged
  ? path.join(process.resourcesPath, 'extensions')
  : path.join(APP_ROOT, 'extensions');
const userExtensionsDir = path.join(userData, 'extensions');
// сборка дочернего процесса с ограничениями лежит вне asar: режим разрешений Node проверяет настоящие пути
const restrictedEntry = path.join(
  app.isPackaged ? process.resourcesPath : APP_ROOT,
  'restricted',
  'ext-restricted.mjs',
);
// режим разработчика: каталог с приоритетом выше пользовательского, под наблюдением
const devExtensionsDir = process.env.DOLPHY_DEV_EXTENSIONS
  ? path.resolve(process.env.DOLPHY_DEV_EXTENSIONS)
  : undefined;

// версия приложения известна у собранного приложения; в разработке проверка
// minAppVersion отключена, если не задан DOLPHY_APP_VERSION (для e2e и отладки)
const devAppVersion = /^\d+\.\d+\.\d+$/.test(
  process.env.DOLPHY_APP_VERSION ?? '',
)
  ? process.env.DOLPHY_APP_VERSION
  : undefined;
const appVersion = app.isPackaged ? app.getVersion() : devAppVersion;
// адрес каталога расширений подменяется только в несобранном приложении (e2e, отладка):
// в собранном идёт официальный
const extensionCatalogUrl = app.isPackaged
  ? undefined
  : process.env.DOLPHY_EXTENSION_CATALOG_URL || undefined;

// безопасный режим, заданный запуском (флаг или переменная): настройкой не снимается
const forceSafeMode = safeModeSource(process.argv, process.env);
// ускоренные часы расписаний для e2e (`DOLPHY_SCHEDULE_TICK_MS`, `DOLPHY_CLOCK_OFFSET_FILE`): только в несобранном приложении
const scheduleClock = scheduleClockOf(process.env, app.isPackaged);

const hostLink = createHostLink({ MessageChannelMain });
// шифр секретов расширений: `safeStorage` есть только в main, хост движка спрашивает по `parentPort`;
// e2e и смоук подменяют хранилище ключей `DOLPHY_FAKE_SAFE_STORAGE` (только в несобранном приложении)
const fakeSafeStorage = fakeSafeStorageOf(process.env, app.isPackaged);
// системные уведомления (`Notification` тоже только в main); e2e пишет их в файл `DOLPHY_NOTIFICATION_LOG` вместо вызова ОС
const notificationLogPath = notificationLogOf(process.env, app.isPackaged);
// диалоги файла импорта и экспорта; e2e подменяет их `DOLPHY_FAKE_FILE_DIALOGS` (только в несобранном приложении)
const fakeFileDialogsDir = fakeFileDialogsOf(process.env, app.isPackaged);
const showMainWindow = () => {
  const [window] = BrowserWindow.getAllWindows();
  if (window === undefined) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
};
const platformServices = createPlatformServices({
  safeStorage,
  notifications: {
    isSupported: () => Notification.isSupported(),
    create: (options) => new Notification(options),
  },
  showWindow: showMainWindow,
  ...(notificationLogPath !== undefined && {
    notificationLog: (entry) =>
      appendFileSync(notificationLogPath, `${JSON.stringify(entry)}\n`),
  }),
  isReady: () => app.isReady(),
  platform: process.platform,
  logger,
  ...(fakeSafeStorage !== undefined && { fake: fakeSafeStorage }),
});
// режим разработчика: хост движка сам перечитывает расширения и применяет их, окна и хосты не перезапускаются;
// правка, пришедшая пока хост запускался, повторяется, когда он готов (первое обнаружение могло её не увидеть)
let engineHost: HostProcessLike | null = null;
let reloadPending = false;
const reloadExtensions = () => {
  engineHost?.postMessage({ type: 'reload-extensions' });
  reloadPending = engineHost === null;
};
// состояние хоста расширений для окна «Настройки → Расширения»: движок узнаёт его от main
let extHostStatus: ExtensionHostStatusDto = 'running';
const publishExtHostStatus = () => {
  engineHost?.postMessage({ type: 'ext-host-status', status: extHostStatus });
};
const extSupervisor = createExtSupervisor({
  utilityProcess,
  hostPath: path.join(__dirname, '../host/ext-host.js'),
  init: { type: 'init', libraryRoot, restrictedEntry },
  logger,
  onHostReady: (host) => hostLink.setExtHost(host),
  onHostExit: () => hostLink.setExtHost(null),
  onStatus: (status) => {
    extHostStatus = status;
    publishExtHostStatus();
  },
  createOutput: outputOf('ext-host'),
});
const supervisor = createSupervisor({
  utilityProcess,
  MessageChannelMain,
  hostPath: path.join(__dirname, '../host/index.js'),
  config: {
    libraryRoot,
    dataDir: path.join(userData, 'data'),
    bundledExtensionsDir,
    userExtensionsDir,
    ...(appVersion ? { appVersion } : {}),
    ...(devExtensionsDir ? { devExtensionsDir } : {}),
    ...(extensionCatalogUrl ? { extensionCatalogUrl } : {}),
    ...(forceSafeMode ? { forceSafeMode } : {}),
    ...scheduleClock,
    logsDir,
  },
  logger,
  createOutput: outputOf('engine'),
  onFatal: () => {
    dialog.showErrorBox(
      'Dolphy',
      'Движок обучения неоднократно завершался с ошибкой. Приложение будет закрыто.',
    );
    app.quit();
  },
  onHostReady: (host) => {
    engineHost = host;
    hostLink.setEngine(host);
    publishExtHostStatus();
    if (reloadPending) reloadExtensions();
  },
  onHostExit: () => {
    engineHost = null;
    hostLink.setEngine(null);
  },
  onMessage: (message) => {
    // зависший синхронный код расширения не прервать: движок просит перезапустить хост
    if (isTypedMessage(message, 'restart-ext-host')) extSupervisor.kill();
    // пользователь просит запустить хост после `gave-up` («Настройки → Расширения»)
    if (isTypedMessage(message, 'reset-ext-host')) extSupervisor.reset();
    // шифр секретов: ответ уходит тому же хосту движка, что спросил
    if (isTypedMessage(message, 'platform-request')) {
      const asker = engineHost;
      void platformServices.handle(message).then((response) => {
        if (response !== null) asker?.postMessage(response);
      });
    }
  },
});

const shells = [
  createWebContentsGuardShell({ app, session }),
  createWindowShell({
    app,
    BrowserWindow,
    shell,
    logger,
    preloadPath: path.join(__dirname, '../preload/index.cjs'),
    indexHtml: path.join(RENDERER_DIST, 'index.html'),
    ...(devServerUrl ? { devServerUrl } : {}),
    hidden: hiddenWindow,
    additionalArguments: smoke ? [SMOKE_ARGUMENT] : [],
  }),
  // ссылки `dolphy://extensions/install/<id>`: схему регистрирует только собранное приложение;
  // скрытое окно e2e на передний план не выводится; смоук-сборка схему не перехватывает
  createDeepLinkShell({
    app,
    ipcMain,
    registerScheme: app.isPackaged && !smoke,
    argv: process.argv,
    logger,
    reveal: hiddenWindow ? () => undefined : showMainWindow,
  }),
  createDevToolsShortcutShell({
    app,
    ...(devExtensionsDir ? { devExtensionsDir } : {}),
    platform: process.platform,
  }),
  createEngineShell({ ipcMain, supervisor }),
  createPlatformShell({
    ipcMain,
    dialog:
      fakeFileDialogsDir === undefined
        ? dialog
        : createFakeFileDialogs(fakeFileDialogsDir),
    files: {
      size: async (filePath) => (await stat(filePath)).size,
      read: (filePath) => readFile(filePath),
      write: (filePath, bytes) => writeFile(filePath, bytes),
    },
    fromWebContents: (sender) =>
      BrowserWindow.fromWebContents(sender as Electron.WebContents),
    clipboard,
    appInfo: () => ({
      // в несобранном приложении `getVersion()` возвращает версию Electron
      appVersion: appVersion ?? 'unpackaged',
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
    }),
  }),
  createLifecycleShell({ app, supervisors: [supervisor, extSupervisor] }),
  createExtensionAssetsShell({
    app,
    protocol,
    net,
    roots: [
      ...(devExtensionsDir ? [devExtensionsDir] : []),
      userExtensionsDir,
      bundledExtensionsDir,
    ],
    fs: { realpath, stat },
    logger,
  }),
  ...(devExtensionsDir
    ? [
        createDevExtensionsShell({
          app,
          dir: devExtensionsDir,
          watch: (dir, listener) => {
            const watcher = watch(dir, { recursive: true }, (_event, name) =>
              listener(name),
            );
            watcher.on('error', (error) => {
              logger.warn({ error, dir }, 'dev extensions watcher failed');
            });
            return watcher;
          },
          timers: { setTimeout, clearTimeout },
          reloadExtensions,
          exists: existsSync,
          logger,
        }),
      ]
    : []),
  ...(smoke
    ? [
        createSmokeShell({
          ipcMain,
          app,
          supervisor,
          logger,
          versions: process.versions,
          packaged: app.isPackaged,
          print: (line) => console.log(line),
        }),
      ]
    : []),
];
for (const shell of shells) shell.register();

app.whenReady().then(() => {
  supervisor.start();
  extSupervisor.start();
});
