import type { MainLogger } from '../logger.ts';
import { SMOKE_ARGUMENT } from '../../../shared/bridge.ts';
import type { Shell } from './types.ts';

interface WindowWebContentsLike {
  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: 'deny' },
  ): void;
  on(
    event: 'will-navigate',
    listener: (event: { preventDefault(): void }) => void,
  ): unknown;
  openDevTools(): void;
}

export interface BrowserWindowLike {
  webContents: WindowWebContentsLike;
  isMinimized(): boolean;
  restore(): void;
  focus(): void;
  loadURL(url: string): Promise<void>;
  loadFile(path: string): Promise<void>;
}

export interface WindowOptions {
  title: string;
  show: boolean;
  webPreferences: {
    preload: string;
    sandbox: true;
    contextIsolation: true;
    nodeIntegration: false;
    additionalArguments: string[];
  };
}

export interface WindowShellDeps {
  app: {
    whenReady(): Promise<unknown>;
    on(event: string, listener: () => void): unknown;
    quit(): void;
  };
  BrowserWindow: {
    new (options: WindowOptions): BrowserWindowLike;
    getAllWindows(): BrowserWindowLike[];
  };
  shell: { openExternal(url: string): Promise<void> };
  logger: MainLogger;
  /** Абсолютный путь к собранному preload (CJS: sandbox не грузит ESM). */
  preloadPath: string;
  indexHtml: string;
  devServerUrl?: string;
  smoke: boolean;
  platform?: string;
}

export const createWindowOptions = (
  preloadPath: string,
  smoke: boolean,
): WindowOptions => ({
  title: 'LMS',
  show: !smoke,
  webPreferences: {
    preload: preloadPath,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    additionalArguments: smoke ? [SMOKE_ARGUMENT] : [],
  },
});

export const createWindowShell = (deps: WindowShellDeps): Shell => ({
  register: () => {
    const { app, BrowserWindow, shell, logger, smoke } = deps;
    let win: BrowserWindowLike | null = null;

    const createWindow = async () => {
      const created = new BrowserWindow(
        createWindowOptions(deps.preloadPath, smoke),
      );
      win = created;
      const { webContents } = created;
      // страница остаётся той, что загрузили: навигация только через main
      webContents.on('will-navigate', (event) => event.preventDefault());
      webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https:')) {
          shell.openExternal(url).catch((error) => {
            logger.error({ error, url }, 'openExternal failed');
          });
        }
        return { action: 'deny' };
      });
      if (deps.devServerUrl) {
        await created.loadURL(deps.devServerUrl);
        if (!smoke) webContents.openDevTools();
      } else {
        await created.loadFile(deps.indexHtml);
      }
    };

    const open = () => {
      createWindow().catch((error) => {
        logger.error({ error }, 'window creation failed');
      });
    };

    app.whenReady().then(open, (error) => {
      logger.error({ error }, 'app is not ready');
    });
    app.on('window-all-closed', () => {
      win = null;
      if ((deps.platform ?? process.platform) !== 'darwin') app.quit();
    });
    app.on('second-instance', () => {
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.focus();
    });
    app.on('activate', () => {
      const [existing] = BrowserWindow.getAllWindows();
      if (existing) existing.focus();
      else open();
    });
  },
});
