import type { MainLogger } from '../logger.ts';
import type { Shell } from './types.ts';

interface WindowWebContentsLike {
  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: 'deny' },
  ): void;
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

/** Ниже этой ширины боковое меню (240px) оставляет странице меньше 660px. */
const MIN_WINDOW_WIDTH = 900;
const MIN_WINDOW_HEIGHT = 600;

export interface WindowOptions {
  title: string;
  show: boolean;
  minWidth: number;
  minHeight: number;
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
  /** Скрытое окно (смоук): без показа и без DevTools. */
  hidden?: boolean;
  /** Аргументы командной строки renderer (доступны preload через `process.argv`). */
  additionalArguments?: readonly string[];
  platform?: string;
}

export const createWindowOptions = (
  preloadPath: string,
  hidden: boolean,
  additionalArguments: readonly string[],
): WindowOptions => ({
  title: 'Dolphy',
  show: !hidden,
  minWidth: MIN_WINDOW_WIDTH,
  minHeight: MIN_WINDOW_HEIGHT,
  webPreferences: {
    preload: preloadPath,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    additionalArguments: [...additionalArguments],
  },
});

export const createWindowShell = (deps: WindowShellDeps): Shell => ({
  register: () => {
    const { app, BrowserWindow, shell, logger } = deps;
    const hidden = deps.hidden ?? false;
    let win: BrowserWindowLike | null = null;

    const createWindow = async () => {
      const created = new BrowserWindow(
        createWindowOptions(
          deps.preloadPath,
          hidden,
          deps.additionalArguments ?? [],
        ),
      );
      win = created;
      const { webContents } = created;
      // навигацию и разрешения закрывает web-contents-guard; здесь https-ссылки
      // уходят в браузер
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
        if (!hidden) webContents.openDevTools();
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
