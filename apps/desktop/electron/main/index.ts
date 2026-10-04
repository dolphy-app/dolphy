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
import { realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createExtSupervisor, isTypedMessage } from './ext-supervisor.ts';
import { createHostLink } from './host-link.ts';
import { createMainLogger } from './logger.ts';
import { createDevExtensionsShell } from './shells/dev-extensions.ts';
import { createEngineShell } from './shells/engine.ts';
import { createExtensionAssetsShell } from './shells/extension-assets.ts';
import { createLifecycleShell } from './shells/lifecycle.ts';
import { createPlatformShell } from './shells/platform.ts';
import { createSmokeShell } from './shells/smoke.ts';
import { createWindowShell } from './shells/window.ts';
import { createSupervisor } from './supervisor.ts';
import type { HostProcessLike } from './supervisor.ts';
import { SMOKE_ARGUMENT } from '../../shared/smoke.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// dist-electron/{main,preload,host}/ и dist/index.html (renderer)
const APP_ROOT = path.join(__dirname, '../..');
const RENDERER_DIST = path.join(APP_ROOT, 'dist');
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

const logger = createMainLogger();

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

const hostLink = createHostLink({ MessageChannelMain });
// режим разработчика: хост движка сам перечитывает расширения и применяет их, окна и хосты не перезапускаются;
// правка, пришедшая пока хост запускался, повторяется, когда он готов (первое обнаружение могло её не увидеть)
let engineHost: HostProcessLike | null = null;
let reloadPending = false;
const reloadExtensions = () => {
  engineHost?.postMessage({ type: 'reload-extensions' });
  reloadPending = engineHost === null;
};
const extSupervisor = createExtSupervisor({
  utilityProcess,
  hostPath: path.join(__dirname, '../host/ext-host.js'),
  init: { type: 'init', libraryRoot, restrictedEntry },
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
      'Dolphy',
      'Движок обучения неоднократно завершался с ошибкой. Приложение будет закрыто.',
    );
    app.quit();
  },
  onHostReady: (host) => {
    engineHost = host;
    hostLink.setEngine(host);
    if (reloadPending) reloadExtensions();
  },
  onHostExit: () => {
    engineHost = null;
    hostLink.setEngine(null);
  },
  // зависший синхронный код расширения не прервать: движок просит перезапустить хост
  onMessage: (message) => {
    if (isTypedMessage(message, 'restart-ext-host')) extSupervisor.kill();
  },
});

const shells = [
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
  createEngineShell({ ipcMain, supervisor }),
  createPlatformShell({
    ipcMain,
    dialog,
    fromWebContents: (sender) =>
      BrowserWindow.fromWebContents(sender as Electron.WebContents),
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
