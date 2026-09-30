import type { MainLogger } from '../logger.ts';
import { restartExtensionHosts } from './extension-reload.ts';
import type { ExtensionReloadDeps } from './extension-reload.ts';
import type { Shell } from './types.ts';

export const DEFAULT_DEV_DEBOUNCE_MS = 300;

export interface DevExtensionsDeps extends ExtensionReloadDeps {
  app: { on(event: 'before-quit', listener: () => void): unknown };
  /** Каталог разработчика (`DOLPHY_DEV_EXTENSIONS`). */
  dir: string;
  /** Рекурсивное наблюдение; `filename` — путь относительно `dir` (или `null`, если ОС его не сообщила). */
  watch(
    dir: string,
    listener: (filename: string | null) => void,
  ): { close(): void };
  /** Задержка на серию изменений; по умолчанию 300 мс. */
  debounceMs?: number;
  timers: {
    setTimeout(callback: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  exists(dir: string): boolean;
  logger: MainLogger;
}

/** Служебные файлы (`.git`, `.DS_Store`, временные файлы редакторов) и зависимости не считаются правкой расширения. */
const isIgnored = (filename: string | null): boolean =>
  filename !== null &&
  filename
    .split(/[\\/]/)
    .some((segment) => segment.startsWith('.') || segment === 'node_modules');

/**
 * Режим разработчика: правка любого файла в `dir` перезапускает оба хоста
 * и перезагружает окна; серия изменений (сборка пишет много файлов) даёт
 * одну перезагрузку. Нет каталога — предупреждение и никакого наблюдения
 * (каталог, созданный позже, не наблюдается).
 */
export const createDevExtensionsShell = (deps: DevExtensionsDeps): Shell => ({
  register: () => {
    const { app, dir, timers, logger } = deps;
    if (!deps.exists(dir)) {
      logger.warn({ dir }, 'DOLPHY_DEV_EXTENSIONS directory does not exist');
      return;
    }
    const debounceMs = deps.debounceMs ?? DEFAULT_DEV_DEBOUNCE_MS;
    let pending: unknown = null;
    let closed = false;

    const reload = () => {
      pending = null;
      logger.info({ dir }, 'dev extensions changed, restarting hosts');
      restartExtensionHosts(deps);
    };

    const onChange = (filename: string | null) => {
      if (closed || isIgnored(filename)) return;
      timers.clearTimeout(pending);
      pending = timers.setTimeout(reload, debounceMs);
    };

    let watcher: { close(): void };
    try {
      watcher = deps.watch(dir, onChange);
    } catch (error) {
      logger.warn({ error, dir }, 'dev extensions directory is not watched');
      return;
    }
    logger.info({ dir }, 'dev extensions directory is watched');
    app.on('before-quit', () => {
      closed = true;
      timers.clearTimeout(pending);
      pending = null;
      watcher.close();
    });
  },
});
