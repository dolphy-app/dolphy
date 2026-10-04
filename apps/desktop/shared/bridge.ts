import type { SmokeBridge } from './smoke.ts';

/** Сведения о сборке и среде для «Скопировать диагностику». */
export interface AppInfo {
  appVersion: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
}

/** Платформенно-зависимое: реализация — в main, renderer видит только этот интерфейс. */
export interface Platform {
  pickDirectory(options?: { title?: string }): Promise<string | null>;
  appInfo(): Promise<AppInfo>;
  /** Кладёт текст в системный буфер обмена (по действию пользователя). Работает и без фокуса окна, в отличие от `navigator.clipboard`. */
  copyText(text: string): Promise<void>;
}

/** Узкий мост `window.dolphy`: ни `ipcRenderer`, ни произвольных каналов. */
export interface DolphyBridge {
  engine: { connect(): void };
  platform: Platform;
  /** Только в смоук-сборке (`shared/smoke.ts`). */
  smoke?: SmokeBridge;
}

export const CHANNELS = {
  engineConnect: 'engine:connect',
  enginePort: 'engine:port',
  pickDirectory: 'platform:pickDirectory',
  appInfo: 'platform:appInfo',
  copyText: 'platform:copyText',
} as const;
