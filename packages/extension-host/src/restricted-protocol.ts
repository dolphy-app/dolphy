import type { ExtensionPermission } from '@dolphy-app/extension-api';
import type { ResolvedExtension } from './discover.ts';
import type {
  ExtRequest,
  ExtResponse,
  HostRequest,
  HostResponse,
  SettingChangedNotice,
} from './protocol.ts';

/** Конверт сообщений между хостом расширений и ограниченным дочерним процессом (IPC). */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LibraryCall =
  { op: 'readText'; path: string } | { op: 'stat'; path: string };

export type LibraryFailure = {
  name: string;
  message: string;
  permission?: ExtensionPermission;
};

/**
 * Голова вызова, чьё тело идёт потоком (см. `transfer-wire.ts`): те же поля,
 * что у `RunImporterRequest`/`RunExporterRequest`, без текста, байт и файлов.
 */
export type StreamedRequest =
  | {
      id: string;
      method: 'runImporter';
      params: {
        extensionId: string;
        importerId: string;
        name: string;
        isolated: boolean;
        /** Поток — файл пользователя: UTF-8 текст или байты. */
        input: 'text' | 'bytes';
      };
    }
  | {
      id: string;
      method: 'runExporter';
      params: {
        extensionId: string;
        exporterId: string;
        isolated: boolean;
        /** Поток — кадры `count` текстовых файлов курса. */
        input: { courseId: string; title: string; count: number };
      };
    };

/** Голова результата, чьё тело идёт потоком: каталог файлов импорта либо файл экспорта. */
export type StreamedResult =
  | { kind: 'files'; count: number }
  | { kind: 'text'; filename: string }
  | { kind: 'bytes'; filename: string };

export type ParentMessage =
  | { t: 'init'; extension: ResolvedExtension }
  | {
      t: 'rpc';
      /** Вызов хоста, ответ на запрос процесса к движку или сообщение без ответа. */
      message: ExtRequest | HostResponse | SettingChangedNotice;
    }
  | {
      /** Вызов с телом потоком: за головой идут `chunk`, всего `size` байт. */
      t: 'stream';
      size: number;
      request: StreamedRequest;
    }
  | { t: 'chunk'; id: string; seq: number; data: string }
  | { t: 'library-result'; id: string; ok: true; value: unknown }
  | { t: 'library-result'; id: string; ok: false; error: LibraryFailure }
  | { t: 'shutdown' };

export type ChildMessage =
  | { t: 'ready' }
  | {
      t: 'rpc';
      /** Ответ на вызов хоста или запрос процесса к данным расширения. */
      message: ExtResponse | HostRequest;
    }
  | {
      /** Успешный ответ на вызов `id` с телом потоком: за головой идут `chunk`, всего `size` байт. */
      t: 'result-stream';
      id: string;
      size: number;
      result: StreamedResult;
    }
  | { t: 'chunk'; id: string; seq: number; data: string }
  | ({ t: 'library'; id: string } & LibraryCall)
  | { t: 'log'; level: LogLevel; fields: object; message?: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** IPC-канал недоверен: проверяем форму, остальное — забота получателя. */
export const isChildMessage = (value: unknown): value is ChildMessage =>
  isObject(value) &&
  (value.t === 'ready' ||
    (value.t === 'rpc' && isObject(value.message)) ||
    (value.t === 'result-stream' &&
      typeof value.id === 'string' &&
      typeof value.size === 'number' &&
      isObject(value.result)) ||
    (value.t === 'chunk' &&
      typeof value.id === 'string' &&
      typeof value.seq === 'number' &&
      typeof value.data === 'string') ||
    (value.t === 'library' &&
      typeof value.id === 'string' &&
      typeof value.path === 'string' &&
      (value.op === 'readText' || value.op === 'stat')) ||
    (value.t === 'log' &&
      typeof value.level === 'string' &&
      isObject(value.fields)));

export const isParentMessage = (value: unknown): value is ParentMessage =>
  isObject(value) &&
  (value.t === 'init' ||
    value.t === 'rpc' ||
    (value.t === 'stream' &&
      typeof value.size === 'number' &&
      isObject(value.request)) ||
    (value.t === 'chunk' &&
      typeof value.id === 'string' &&
      typeof value.seq === 'number' &&
      typeof value.data === 'string') ||
    value.t === 'library-result' ||
    value.t === 'shutdown');
