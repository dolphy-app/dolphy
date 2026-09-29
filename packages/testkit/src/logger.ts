import type { Logger } from '@lms/engine';

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface CapturedLog {
  level: LogLevel;
  fields: object;
  message?: string;
}

/** Логгер, запоминающий записи: проверять, что ошибка залогирована, а не проглочена. */
export const createCapturingLogger = () => {
  const records: CapturedLog[] = [];
  const write =
    (level: LogLevel) =>
    (fields: object, message?: string): void => {
      records.push(
        message === undefined ? { level, fields } : { level, fields, message },
      );
    };
  const logger: Logger = {
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
  };
  return { logger, records };
};
