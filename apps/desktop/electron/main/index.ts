import {
  BrowserWindow,
  MessageChannelMain,
  app,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
  utilityProcess,
} from 'electron';
import { existsSync, watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createExtSupervisor, isTypedMessage } from './ext-supervisor.ts';
import { createHostLink } from './host-link.ts';
import { createMainLogger } from './logger.ts';
import { createDevExtensionsShell } from './shells/dev-extensions.ts';
import { createExtensionsApplyShell } from './shells/extensions-apply.ts';
import { createEngineShell } from './shells/engine.ts';
import { createExtensionAssetsShell } from './shells/extension-assets.ts';
import { createLifecycleShell } from './shells/lifecycle.ts';
import { createPlatformShell } from './shells/platform.ts';
import { createSmokeShell } from './shells/smoke.ts';
import { createWindowShell } from './shells/window.ts';
import { createSupervisor } from './supervisor.ts';
import { SMOKE_ARGUMENT } from '../../shared/smoke.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// dist-electron/{main,preload,host}/ и dist/index.html (renderer)
const APP_ROOT = path.join(__dirname, '../..');
const RENDERER_DIST = path.join(APP_ROOT, 'dist');
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

const logger = createMainLogger();

// смоук существует только в смоук-сборке (SPIRULA_SMOKE_BUILD=1 при vite build):
// в релизном бандле флаг — false, весь код за ним вырезан
const smoke = __SPIRULA_SMOKE_BUILD__ && process.env.SPIRULA_SMOKE === '1';
const smokeUserData = __SPIRULA_SMOKE_BUILD__
  ? process.env.SPIRULA_SMOKE_USER_DATA
  : undefined;
if (smoke && smokeUserData) app.setPath('userData', smokeUserData);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const userData = app.getPath('userData');
const libraryRoot =
  (smoke && process.env.SPIRULA_SMOKE_LIBRARY) ||
  path.join(userData, 'library');
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
const devExtensionsDir = process.env.SPIRULA_DEV_EXTENSIONS
  ? path.resolve(process.env.SPIRULA_DEV_EXTENSIONS)
  : undefined;

// версия приложения известна у собранного приложения; в разработке проверка
// minAppVersion отключена, если не задан SPIRULA_APP_VERSION (для e2e и отладки)
const devAppVersion = /^\d+\.\d+\.\d+$/.test(
  process.env.SPIRULA_APP_VERSION ?? '',
)
  ? process.env.SPIRULA_APP_VERSION
  : undefined;
const appVersion = app.isPackaged ? app.getVersion() : devAppVersion;
// адрес каталога расширений подменяется только в несобранном приложении (e2e, отладка):
// в собранном идёт официальный
const extensionCatalogUrl = app.isPackaged
  ? undefined
  : process.env.SPIRULA_EXTENSION_CATALOG_URL || undefined;

const hostLink = createHostLink({ MessageChannelMain });
const extSupervisor = createExtSupervisor({
  utilityProcess,
  hostPath: path.join(__dirname, '../host/ext-host.js'),
  init: {
    type: 'init',
    libraryRoot,
    bundledExtensionsDir,
    userExtensionsDir,
    restrictedEntry,
    ...(appVersion ? { appVersion } : {}),
    ...(devExtensionsDir ? { devExtensionsDir } : {}),
  },
  logger,
  onHostReady: (host) => hostLink.setExtHost(host),
  onHostExit: () => hostLink.setExtHost(null),
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
  },
  logger,
  onFatal: () => {
    dialog.showErrorBox(
      'Spirula',
      'Движок обучения неоднократно завершался с ошибкой. Приложение будет закрыто.',
    );
    app.quit();
  },
  onHostReady: (host) => hostLink.setEngine(host),
  onHostExit: () => hostLink.setEngine(null),
  // зависший синхронный код расширения не прервать: движок просит перезапустить хост
  onMessage: (message) => {
    if (isTypedMessage(message, 'restart-ext-host')) extSupervisor.kill();
  },
});

// один путь «применить изменения расширений» для режима разработчика и кнопки в настройках
const restartHosts = () => {
  extSupervisor.restart();
  supervisor.restart();
};
const windows = () =>
  BrowserWindow.getAllWindows().map((win) => win.webContents);

const shells = [
  createWindowShell({
    app,
    BrowserWindow,
    shell,
    logger,
    preloadPath: path.join(__dirname, '../preload/index.cjs'),
    indexHtml: path.join(RENDERER_DIST, 'index.html'),
    ...(devServerUrl ? { devServerUrl } : {}),
    hidden: smoke,
    additionalArguments: smoke ? [SMOKE_ARGUMENT] : [],
  }),
  createEngineShell({ ipcMain, supervisor }),
  createPlatformShell({
    ipcMain,
    dialog,
    fromWebContents: (sender) =>
      BrowserWindow.fromWebContents(sender as Electron.WebContents),
  }),
  createExtensionsApplyShell({
    ipcMain,
    restartHosts,
    windows,
    timers: { setTimeout },
    logger,
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
    exists: existsSync,
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
          restartHosts,
          windows,
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
