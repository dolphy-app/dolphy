import type { LogFile } from './log-file.ts';

export interface MainLogger {
  debug(fields: object, message?: string): void;
  info(fields: object, message?: string): void;
  warn(fields: object, message?: string): void;
  error(fields: object, message?: string): void;
}

const serialize = (value: unknown): unknown =>
  value instanceof Error
    ? { name: value.name, message: value.message, stack: value.stack }
    : value;

/** JSON-строки в stderr, как у логгера хоста; с `file` ещё и в файл журнала. */
export const createMainLogger = (file?: LogFile): MainLogger => {
  const write = (level: string, fields: object, message?: string) => {
    const safe = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, serialize(value)]),
    );
    const record = { level, source: 'main', message, ...safe, at: Date.now() };
    console.error(JSON.stringify(record));
    file?.write('main', record);
  };
  return {
    debug: (fields, message) => write('debug', fields, message),
    info: (fields, message) => write('info', fields, message),
    warn: (fields, message) => write('warn', fields, message),
    error: (fields, message) => write('error', fields, message),
  };
};
