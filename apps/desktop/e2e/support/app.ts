import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { _electron as electron } from 'playwright-core';
import type { ElectronApplication, Page } from 'playwright-core';

const APP_DIR = fileURLToPath(new URL('../..', import.meta.url));
/** Релизная сборка для e2e: `vite build` с `DOLPHY_BUILD_OUT=dist-e2e` (global-setup). */
export const E2E_BUILD_DIR = 'dist-e2e';

/**
 * `DOLPHY_E2E_SHOW=1`: показывать окна (смотреть прогон глазами). Окна
 * показываются без фокуса (`showInactive`), приложение остаётся без активации.
 */
export const E2E_SHOW = process.env.DOLPHY_E2E_SHOW === '1';

/**
 * Space yabai, на который уходят видимые окна прогона (`DOLPHY_E2E_SPACE`,
 * по умолчанию 3). Нужен `yabai` в `PATH`; без него окна остаются где созданы.
 */
const E2E_SPACE = process.env.DOLPHY_E2E_SPACE ?? '3';

const execFileAsync = promisify(execFile);

interface YabaiWindow {
  id: number;
  pid: number;
  space: number;
  'is-floating': boolean;
}

const yabai = async (...args: string[]) =>
  (await execFileAsync('yabai', ['-m', ...args])).stdout;

/**
 * Переносит окна процесса на `E2E_SPACE` и делает их плавающими (иначе yabai
 * растянет окно по раскладке). yabai видит окно только после показа и с
 * задержкой, поэтому ждём все `total` окон.
 */
const placeWindows = async (pid: number, total: number) => {
  const { index: space } = JSON.parse(
    await yabai('query', '--spaces', '--space', E2E_SPACE),
  ) as { index: number };
  const own = async () =>
    (JSON.parse(await yabai('query', '--windows')) as YabaiWindow[]).filter(
      (window) => window.pid === pid,
    );
  let windows = await own();
  for (let attempt = 0; windows.length < total && attempt < 50; attempt++) {
    await sleep(100);
    windows = await own();
  }
  for (const window of windows.filter((item) => item.space !== space)) {
    // float до переноса: на тайловом space yabai сначала растянет окно
    if (!window['is-floating']) {
      await yabai('window', String(window.id), '--toggle', 'float');
    }
    await yabai('window', String(window.id), '--space', String(space));
  }
};

/**
 * macOS: копия `Electron.app` с `LSUIElement` (global-setup). Без Dock и без активации
 * при старте процесса: обычный Electron на мгновение становится активным приложением
 * и перехватывает клавиатуру и фокус оконного менеджера, даже со скрытым окном.
 */
export const QUIET_ELECTRON_APP = join(APP_DIR, E2E_BUILD_DIR, 'Electron.app');

const quietElectronPath = join(QUIET_ELECTRON_APP, 'Contents/MacOS/Electron');

/**
 * Показывает скрытые окна без фокуса: `showInactive` не делает окно
 * ключевым. Нужен обычный Electron: у копии с `LSUIElement` у окна нет роли AX
 * и yabai не может его перенести. На время переноса на `E2E_SPACE` окна
 * прозрачны, чтобы не мелькать на текущем space; размер yabai успевает
 * изменить, поэтому исходные границы возвращаются после переноса.
 */
const revealWindows = async (app: ElectronApplication) => {
  const { total, bounds } = await app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    const shown: Record<number, Electron.Rectangle> = {};
    for (const window of windows) {
      if (window.isVisible()) continue;
      shown[window.id] = window.getBounds();
      window.setOpacity(0);
      window.showInactive();
    }
    return { total: windows.length, bounds: shown };
  });
  const pid = app.process().pid;
  try {
    if (process.platform === 'darwin' && pid !== undefined) {
      await placeWindows(pid, total);
    }
  } catch (error) {
    console.warn(`[e2e] yabai placement skipped: ${String(error)}`);
  } finally {
    await app.evaluate(({ BrowserWindow }, original) => {
      for (const window of BrowserWindow.getAllWindows()) {
        const rect = original[window.id];
        if (rect !== undefined) window.setBounds(rect);
        window.setOpacity(1);
      }
    }, bounds);
  }
};

const LIBRARY_SOURCES = [
  '../../../../packages/engine/test/fixtures/libraries/sql-course/lib_kb',
  '../../../../packages/engine/test/fixtures/libraries/choice-course/lib_kb',
  '../../dev-library',
].map((path) => fileURLToPath(new URL(path, import.meta.url)));

/** Библиотека, из которой берётся содержимое упражнений (эталонные решения SQL). */
export const SEEDED_LIBRARY_SOURCES = LIBRARY_SOURCES;

export interface WorkspaceOptions {
  /** Каталоги расширений: имя подкаталога → источник; копируются в `<userData>/extensions`. */
  extensions?: Record<string, string>;
  /** Дополнительные файлы библиотеки: путь от корня библиотеки → содержимое. */
  libraryFiles?: Record<string, string>;
}

export interface Workspace {
  /** Корень `userData` приложения: `library/` и `data/engine.db`. */
  readonly userData: string;
  dispose(): Promise<void>;
}

/** Временный `userData` с теми же курсами, что кладёт `pnpm dev:seed`. */
export const createWorkspace = async (
  options: WorkspaceOptions = {},
): Promise<Workspace> => {
  const root = await mkdtemp(join(tmpdir(), 'dolphy-e2e-'));
  const userData = join(root, 'userData');
  const library = join(userData, 'library');
  await mkdir(library, { recursive: true });
  for (const source of LIBRARY_SOURCES) {
    await cp(source, library, { recursive: true, force: true });
  }
  for (const [path, content] of Object.entries(options.libraryFiles ?? {})) {
    await mkdir(dirname(join(library, path)), { recursive: true });
    await writeFile(join(library, path), content);
  }
  for (const [name, source] of Object.entries(options.extensions ?? {})) {
    await cp(source, join(userData, 'extensions', name), { recursive: true });
  }
  return {
    userData,
    dispose: () => rm(root, { recursive: true, force: true }),
  };
};

export interface DolphyApp {
  readonly page: Page;
  /**
   * Второе окно приложения (тот же `userData`, тот же движок): отдельное
   * соединение с движком, чтобы менять расширения в одном окне, не трогая
   * экран другого.
   */
  openWindow(): Promise<Page>;
  /** `pid` живого хоста движка (`utilityProcess` `dolphy-engine`) или `null`, пока супервизор его перезапускает. */
  engineHostPid(): Promise<number | null>;
  /**
   * Убивает хост движка `SIGKILL` по `pid`, как внезапный сбой: супервизор
   * перезапускает его, окна получают новый порт. Возвращает убитый `pid`.
   */
  killEngineHost(): Promise<number>;
  /** Выполняет функцию в главном процессе (модуль `electron` — первый аргумент). */
  evaluateMain: ElectronApplication['evaluate'];
  /** Закрывает приложение и ждёт, пока хост движка отпустит `engine.db`. */
  close(): Promise<void>;
}

/**
 * Настоящий Electron: main → preload → utilityProcess движка → SQLite.
 * `--user-data-dir` отделяет данные (и single-instance lock) от dev-запуска;
 * `--lang=ru` фиксирует язык интерфейса, на который рассчитаны селекторы.
 */
export const launchApp = async (
  userData: string,
  env?: Record<string, string>,
): Promise<DolphyApp> => {
  const executablePath =
    process.platform === 'darwin' && !E2E_SHOW
      ? quietElectronPath
      : (createRequire(import.meta.url)('electron') as string);
  const app: ElectronApplication = await electron.launch({
    executablePath,
    cwd: APP_DIR,
    args: [
      join(E2E_BUILD_DIR, 'dist-electron/main/index.js'),
      `--user-data-dir=${userData}`,
      '--lang=ru',
      // окно на другом space yabai считается перекрытым: без этого Chromium
      // замедляет его и iframe панелей не успевают ответить
      ...(E2E_SHOW
        ? [
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
          ]
        : []),
    ],
    // `env` в Playwright заменяет окружение целиком: добавки накладываются на process.env;
    // окна создаются скрытыми, чтобы прогон не перехватывал фокус
    // (`DOLPHY_E2E_SHOW=1` показывает их без фокуса, см. `revealWindows`)
    env: {
      ...(process.env as Record<string, string>),
      DOLPHY_HIDDEN_WINDOW: '1',
      ...env,
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  if (E2E_SHOW) await revealWindows(app);
  // отладочные сообщения renderer мешают читать отчёт: показываем только ошибки
  page.on('pageerror', (error) => {
    console.error(`[renderer pageerror] ${error.message}`);
  });
  const engineHostPid = () =>
    app.evaluate(
      ({ app: electronApp }) =>
        electronApp
          .getAppMetrics()
          .find(
            (metric) =>
              metric.type === 'Utility' && metric.name === 'dolphy-engine',
          )?.pid ?? null,
    );
  return {
    page,
    engineHostPid,
    evaluateMain: app.evaluate.bind(app),
    killEngineHost: async () => {
      const pid = await engineHostPid();
      if (pid === null) throw new Error('engine host is not running');
      process.kill(pid, 'SIGKILL');
      return pid;
    },
    openWindow: async () => {
      const opened = app.waitForEvent('window');
      await app.evaluate(
        ({ BrowserWindow }, { preload }) => {
          const [first] = BrowserWindow.getAllWindows();
          if (first === undefined) throw new Error('no window to copy');
          const next = new BrowserWindow({
            show: false,
            width: 1100,
            height: 800,
            // как у окна приложения (`createWindowOptions`); `preload` из настроек окна не прочитать
            webPreferences: {
              preload,
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
            },
          });
          // маршрут первого окна (например, сессия) не копируем: второе окно начинает с плана
          const url = new URL(first.webContents.getURL());
          url.hash = '';
          void next.loadURL(url.href);
        },
        {
          preload: join(
            APP_DIR,
            E2E_BUILD_DIR,
            'dist-electron/preload/index.cjs',
          ),
        },
      );
      const second = await opened;
      await second.waitForLoadState('domcontentloaded');
      if (E2E_SHOW) await revealWindows(app);
      second.on('pageerror', (error) => {
        console.error(`[renderer pageerror] ${error.message}`);
      });
      return second;
    },
    close: async () => {
      await app.close();
    },
  };
};
