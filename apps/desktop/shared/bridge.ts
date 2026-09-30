import type { SmokeBridge } from './smoke.ts';

/** Платформенно-зависимое: реализация — в main, renderer видит только этот интерфейс. */
export interface Platform {
  pickDirectory(options?: { title?: string }): Promise<string | null>;
}

/** Применение изменений в каталогах расширений. */
export interface ExtensionsBridge {
  /** Перезапускает хосты (движок и расширений) и перезагружает окно; ответ приходит до перезагрузки. */
  apply(): Promise<void>;
}

/** Узкий мост `window.spirula`: ни `ipcRenderer`, ни произвольных каналов. */
export interface SpirulaBridge {
  engine: { connect(): void };
  platform: Platform;
  extensions: ExtensionsBridge;
  /** Только в смоук-сборке (`shared/smoke.ts`). */
  smoke?: SmokeBridge;
}

export const CHANNELS = {
  engineConnect: 'engine:connect',
  enginePort: 'engine:port',
  pickDirectory: 'platform:pickDirectory',
  applyExtensions: 'extensions:apply',
} as const;
