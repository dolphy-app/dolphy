import {
  BrowserWindow,
  MessageChannelMain,
  app,
  dialog,
  ipcMain,
  shell,
  utilityProcess,
} from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createMainLogger } from './logger.ts';
import { createEngineShell } from './shells/engine.ts';
import { createLifecycleShell } from './shells/lifecycle.ts';
import { createPlatformShell } from './shells/platform.ts';
import { createSmokeShell } from './shells/smoke.ts';
import { createWindowShell } from './shells/window.ts';
import { createSupervisor } from './supervisor.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// dist-electron/{main,preload,host}/ и dist/index.html (renderer)
const APP_ROOT = path.join(__dirname, '../..');
const RENDERER_DIST = path.join(APP_ROOT, 'dist');
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

const logger = createMainLogger();

// smoke — только для проверки сквозного пути; упакованное приложение его игнорирует
const smoke = process.env.LMS_SMOKE === '1' && !app.isPackaged;
const smokeUserData = process.env.LMS_SMOKE_USER_DATA;
if (smoke && smokeUserData) app.setPath('userData', smokeUserData);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const userData = app.getPath('userData');
const supervisor = createSupervisor({
  utilityProcess,
  MessageChannelMain,
  hostPath: path.join(__dirname, '../host/index.js'),
  config: {
    libraryRoot:
      (smoke && process.env.LMS_SMOKE_LIBRARY) ||
      path.join(userData, 'library'),
    dataDir: path.join(userData, 'data'),
  },
  logger,
  onFatal: () => {
    dialog.showErrorBox(
      'LMS',
      'Движок обучения неоднократно завершался с ошибкой. Приложение будет закрыто.',
    );
    app.quit();
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
    smoke,
  }),
  createEngineShell({ ipcMain, supervisor }),
  createPlatformShell({
    ipcMain,
    dialog,
    fromWebContents: (sender) =>
      BrowserWindow.fromWebContents(sender as Electron.WebContents),
  }),
  createLifecycleShell({ app, supervisor }),
  ...(smoke
    ? [
        createSmokeShell({
          ipcMain,
          app,
          supervisor,
          logger,
          versions: process.versions,
          print: (line) => console.log(line),
        }),
      ]
    : []),
];
for (const shell of shells) shell.register();

app.whenReady().then(() => supervisor.start());
