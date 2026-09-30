import type { ExtensionPermission } from '@spirula/extension-api';
import type { ResolvedExtension } from './discover.ts';
import type { ExtRequest, ExtResponse } from './protocol.ts';

/** Конверт сообщений между хостом расширений и ограниченным дочерним процессом (IPC). */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LibraryCall =
  { op: 'readText'; path: string } | { op: 'stat'; path: string };

export type LibraryFailure = {
  name: string;
  message: string;
  permission?: ExtensionPermission;
};

export type ParentMessage =
  | { t: 'init'; extension: ResolvedExtension }
  | { t: 'rpc'; message: ExtRequest }
  | { t: 'library-result'; id: string; ok: true; value: unknown }
  | { t: 'library-result'; id: string; ok: false; error: LibraryFailure }
  | { t: 'shutdown' };

export type ChildMessage =
  | { t: 'ready' }
  | { t: 'rpc'; message: ExtResponse }
  | ({ t: 'library'; id: string } & LibraryCall)
  | { t: 'log'; level: LogLevel; fields: object; message?: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** IPC-канал недоверен: проверяем форму, остальное — забота получателя. */
export const isChildMessage = (value: unknown): value is ChildMessage =>
  isObject(value) &&
  (value.t === 'ready' ||
    (value.t === 'rpc' && isObject(value.message)) ||
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
    value.t === 'library-result' ||
    value.t === 'shutdown');
