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

const write = (level: string, fields: object, message?: string) => {
  const safe = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, serialize(value)]),
  );
  console.error(
    JSON.stringify({ level, source: 'main', message, ...safe, at: Date.now() }),
  );
};

/** JSON-строки в stderr, как у логгера хоста. */
export const createMainLogger = (): MainLogger => ({
  debug: (fields, message) => write('debug', fields, message),
  info: (fields, message) => write('info', fields, message),
  warn: (fields, message) => write('warn', fields, message),
  error: (fields, message) => write('error', fields, message),
});
