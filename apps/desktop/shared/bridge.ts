import type { SmokeBridge } from './smoke.ts';

/** Платформенно-зависимое: реализация — в main, renderer видит только этот интерфейс. */
export interface Platform {
  pickDirectory(options?: { title?: string }): Promise<string | null>;
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
} as const;
