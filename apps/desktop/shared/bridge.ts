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

/**
 * Результат `pickFile`. Путь файла окну и расширению не отдаётся: main читает
 * файл сам и возвращает только имя и байты.
 */
export type PickedFile =
  | { status: 'picked'; name: string; bytes: Uint8Array }
  /** Файл больше `MAX_EXTENSION_TRANSFER_BYTES`: содержимое не читалось. */
  | { status: 'too-large'; name: string }
  /** Расширение выбранного файла вне `accept` (диалог «все файлы»). */
  | { status: 'unsupported'; name: string };

/** Платформенно-зависимое: реализация — в main, renderer видит только этот интерфейс. */
export interface Platform {
  pickDirectory(options?: { title?: string }): Promise<string | null>;
  /**
   * Системный диалог выбора файла с фильтром по `accept` (расширения в нижнем
   * регистре с точкой, 1–8). Отмена — `null`. Выбор файла — согласие
   * пользователя на импорт: подделать его из расширения нельзя.
   */
  pickFile(options: {
    accept: readonly string[];
    title?: string;
  }): Promise<PickedFile | null>;
  /**
   * Системный диалог сохранения с предложенным именем (берётся только имя без
   * каталога); пишет байты туда, куда указал пользователь. `canceled` —
   * пользователь отказался, ничего не записано.
   */
  saveFile(options: {
    suggestedName: string;
    bytes: Uint8Array;
  }): Promise<'saved' | 'canceled'>;
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
  pickFile: 'platform:pickFile',
  saveFile: 'platform:saveFile',
  appInfo: 'platform:appInfo',
  copyText: 'platform:copyText',
} as const;
