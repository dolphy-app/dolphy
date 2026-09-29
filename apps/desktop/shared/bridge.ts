/** Платформенно-зависимое: реализация — в main, renderer видит только этот интерфейс. */
export interface Platform {
  pickDirectory(options?: { title?: string }): Promise<string | null>;
}

/** Только для `LMS_SMOKE=1` в неупакованной сборке: отчёт о сквозной проверке. */
export interface SmokeBridge {
  report(result: unknown): void;
  killHost(): Promise<boolean>;
}

/** Узкий мост `window.lms`: ни `ipcRenderer`, ни произвольных каналов. */
export interface LmsBridge {
  engine: { connect(): void };
  platform: Platform;
  smoke?: SmokeBridge;
}

export const CHANNELS = {
  engineConnect: 'engine:connect',
  enginePort: 'engine:port',
  pickDirectory: 'platform:pickDirectory',
  smokeReport: 'smoke:report',
  smokeKillHost: 'smoke:killHost',
} as const;

/** Аргумент командной строки renderer: preload по нему включает `smoke`. */
export const SMOKE_ARGUMENT = '--lms-smoke';
