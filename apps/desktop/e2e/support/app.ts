import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import type { ElectronApplication, Page } from 'playwright-core';

const APP_DIR = fileURLToPath(new URL('../..', import.meta.url));
/** Релизная сборка для e2e: `vite build` с `LMS_BUILD_OUT=dist-e2e` (global-setup). */
export const E2E_BUILD_DIR = 'dist-e2e';

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
  const root = await mkdtemp(join(tmpdir(), 'lms-e2e-'));
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

export interface LmsApp {
  readonly page: Page;
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
): Promise<LmsApp> => {
  const executablePath = createRequire(import.meta.url)('electron') as string;
  const app: ElectronApplication = await electron.launch({
    executablePath,
    cwd: APP_DIR,
    args: [
      join(E2E_BUILD_DIR, 'dist-electron/main/index.js'),
      `--user-data-dir=${userData}`,
      '--lang=ru',
    ],
    // `env` в Playwright заменяет окружение целиком: добавки накладываются на process.env
    ...(env
      ? { env: { ...(process.env as Record<string, string>), ...env } }
      : {}),
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // отладочные сообщения renderer мешают читать отчёт: показываем только ошибки
  page.on('pageerror', (error) => {
    console.error(`[renderer pageerror] ${error.message}`);
  });
  return {
    page,
    close: async () => {
      await app.close();
    },
  };
};
