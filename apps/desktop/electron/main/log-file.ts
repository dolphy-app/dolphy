import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';

/** Кто пишет в журнал: процесс приложения. */
export type LogSource = 'main' | 'engine' | 'ext-host';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** Строка длиннее этого усекается: один гигантский вывод не должен ломать ротацию. */
export const MAX_LINE_CHARS = 64 * 1024;

/**
 * Имя файла: `dolphy-ГГГГ-ММ-ДД[.N].log`. Тот же формат читает
 * `createFileLogReader` (`@dolphy-app/engine/node`); порядок — по дате, затем по `N`.
 */
const FILE_NAME = /^dolphy-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.log$/;

export interface LogFileSystem {
  mkdir(dir: string): void;
  list(dir: string): string[];
  stat(path: string): { size: number; mtimeMs: number };
  append(path: string, text: string): void;
  remove(path: string): void;
}

export const nodeLogFileSystem: LogFileSystem = {
  mkdir: (dir) => void mkdirSync(dir, { recursive: true }),
  list: (dir) => readdirSync(dir),
  stat: (path) => statSync(path),
  append: (path, text) => appendFileSync(path, text),
  remove: (path) => rmSync(path, { force: true }),
};

export interface LogFileOptions {
  dir: string;
  clock: { now(): number };
  fs?: LogFileSystem;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  retentionMs?: number;
  /** Запись или уборка не удалась: журнал не должен ронять приложение. Вызывается раз на серию отказов. */
  onError?(error: unknown): void;
}

export interface LogFile {
  /** Запись приложения (main): поля как есть, `source` ставит писатель. */
  write(source: LogSource, record: object): void;
  /** Строка stderr дочернего процесса: JSON-запись логгера или произвольный текст. */
  writeLine(source: LogSource, line: string): void;
}

interface Placement {
  day: string;
  index: number;
  path: string;
  size: number;
}

interface Named {
  name: string;
  day: string;
  index: number;
}

const pad = (value: number, width = 2): string =>
  String(value).padStart(width, '0');

/** Календарный день по местному времени. */
const dayOf = (ms: number): string => {
  const date = new Date(ms);
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const nameOf = (day: string, index: number): string =>
  index === 0 ? `dolphy-${day}.log` : `dolphy-${day}.${index}.log`;

const parseName = (name: string): Named | null => {
  const match = FILE_NAME.exec(name);
  if (match === null) return null;
  return { name, day: match[1] as string, index: Number(match[2] ?? 0) };
};

const byAge = (a: Named, b: Named): number =>
  a.day === b.day ? a.index - b.index : a.day < b.day ? -1 : 1;

const replacer = (_key: string, value: unknown): unknown => {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return typeof value === 'bigint' ? value.toString() : value;
};

const isLevel = (value: unknown): value is LogLevel =>
  typeof value === 'string' && LEVELS.includes(value as LogLevel);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Поля, которыми запись описывается сама; остальное идёт в запись как есть. */
const OWN_KEYS = new Set(['level', 'source', 'message', 'msg', 'at', 'time']);

const instantOf = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * Запись журнала: `{level, source, message, at, ...поля}`. Логгеры движка и
 * хоста пишут `msg` и `time`, логгер main — `message` и `at`; уровень вне списка
 * становится `info`, источник всегда тот, что назван писателем (процесс не
 * подписывается чужим именем).
 */
const recordOf = (
  source: LogSource,
  value: Record<string, unknown>,
  now: number,
): Record<string, unknown> => {
  const message = value.message ?? value.msg;
  const extra = Object.fromEntries(
    Object.entries(value).filter(([key]) => !OWN_KEYS.has(key)),
  );
  return {
    level: isLevel(value.level) ? value.level : 'info',
    source,
    message: typeof message === 'string' ? message : '',
    at: instantOf(value.at ?? value.time, now),
    ...extra,
  };
};

const serialize = (record: Record<string, unknown>): string => {
  const text = JSON.stringify(record, replacer);
  if (text.length <= MAX_LINE_CHARS) return text;
  const message = String(record.message ?? '');
  return JSON.stringify({
    level: record.level,
    source: record.source,
    message: `${message.slice(0, 2000)}…`,
    at: record.at,
    truncatedChars: text.length,
  });
};

/**
 * Файловый журнал приложения: JSON-строки в `<dir>/dolphy-ГГГГ-ММ-ДД[.N].log`.
 * Новый файл — каждый день и по достижении `maxFileBytes`. При запуске и смене
 * файла удаляются файлы старше `retentionMs`, затем самые старые, пока сумма
 * больше `maxTotalBytes`; текущий файл не удаляется. Единственный писатель —
 * main: без гонок за файл и ротацию.
 */
export const createLogFile = (options: LogFileOptions): LogFile => {
  const { dir, clock } = options;
  const fs = options.fs ?? nodeLogFileSystem;
  const maxFileBytes = options.maxFileBytes ?? MAX_FILE_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? MAX_TOTAL_BYTES;
  const retentionMs = options.retentionMs ?? RETENTION_MS;
  let current: Placement | null = null;
  let failing = false;

  const fail = (error: unknown): void => {
    if (failing) return;
    failing = true;
    options.onError?.(error);
  };

  const files = (): Named[] => {
    try {
      return fs
        .list(dir)
        .flatMap((name) => parseName(name) ?? [])
        .sort(byAge);
    } catch {
      return [];
    }
  };

  const sizeOf = (path: string): number => {
    try {
      return fs.stat(path).size;
    } catch {
      return 0;
    }
  };

  /** Файл дня: последний существующий, если он ещё не полон. */
  const place = (day: string, bytes: number): Placement => {
    const last = files()
      .filter((file) => file.day === day)
      .at(-1);
    let index = last?.index ?? 0;
    let size = last === undefined ? 0 : sizeOf(join(dir, last.name));
    if (size > 0 && size + bytes > maxFileBytes) {
      index += 1;
      size = 0;
    }
    return { day, index, path: join(dir, nameOf(day, index)), size };
  };

  const retain = (keep: string): void => {
    const now = clock.now();
    const sized = files().map((file) => {
      const path = join(dir, file.name);
      try {
        const { size, mtimeMs } = fs.stat(path);
        return { file, path, size, mtimeMs };
      } catch {
        return { file, path, size: 0, mtimeMs: now };
      }
    });
    const alive: typeof sized = [];
    for (const item of sized) {
      if (item.path !== keep && item.mtimeMs < now - retentionMs) {
        fs.remove(item.path);
      } else alive.push(item);
    }
    let total = alive.reduce((sum, item) => sum + item.size, 0);
    for (const item of alive) {
      if (total <= maxTotalBytes) break;
      if (item.path === keep) continue;
      fs.remove(item.path);
      total -= item.size;
    }
  };

  const open = (day: string, bytes: number): Placement => {
    fs.mkdir(dir);
    const next = place(day, bytes);
    try {
      retain(next.path);
    } catch (error) {
      fail(error);
    }
    return next;
  };

  /** Файл, в который пойдёт запись в `bytes` знаков; ротация — по дню и размеру. */
  const target = (bytes: number): Placement => {
    const day = dayOf(clock.now());
    if (
      current !== null &&
      current.day === day &&
      (current.size === 0 || current.size + bytes <= maxFileBytes)
    ) {
      return current;
    }
    if (current !== null && current.day === day) {
      const index = current.index + 1;
      current = {
        day,
        index,
        path: join(dir, nameOf(day, index)),
        size: 0,
      };
      try {
        retain(current.path);
      } catch (error) {
        fail(error);
      }
      return current;
    }
    current = open(day, bytes);
    return current;
  };

  const append = (record: Record<string, unknown>): void => {
    try {
      const text = `${serialize(record)}\n`;
      const bytes = Buffer.byteLength(text);
      const file = target(bytes);
      fs.append(file.path, text);
      file.size += bytes;
      failing = false;
    } catch (error) {
      fail(error);
    }
  };

  // уборка при запуске: старые файлы уходят до первой записи
  try {
    current = open(dayOf(clock.now()), 0);
  } catch (error) {
    fail(error);
  }

  return {
    write: (source, record) =>
      append(recordOf(source, record as Record<string, unknown>, clock.now())),
    writeLine(source, line) {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        value = undefined;
      }
      if (isRecord(value)) append(recordOf(source, value, clock.now()));
      else
        append(recordOf(source, { level: 'warn', message: line }, clock.now()));
    },
  };
};

export interface OutputMirror {
  stdout: { write(chunk: Uint8Array | string): unknown };
  stderr: { write(chunk: Uint8Array | string): unknown };
}

export interface ProcessOutput {
  stdout(chunk: Uint8Array | string): void;
  stderr(chunk: Uint8Array | string): void;
  /** Процесс завершился: неполная последняя строка тоже уходит в журнал. */
  flush(): void;
}

/**
 * Вывод дочернего процесса (`stdio: 'pipe'`): оба потока повторяются в
 * свои потоки main как раньше (вывод для разработчика прежний), stderr
 * построчно пишется в файл журнала.
 */
export const createProcessOutput = (options: {
  source: LogSource;
  file: LogFile;
  mirror: OutputMirror;
}): ProcessOutput => {
  const { source, file, mirror } = options;
  const decoder = new TextDecoder();
  let pending = '';
  const emit = (line: string): void => {
    const text = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (text.trim() !== '') file.writeLine(source, text);
  };
  return {
    stdout: (chunk) => void mirror.stdout.write(chunk),
    stderr(chunk) {
      mirror.stderr.write(chunk);
      const text =
        typeof chunk === 'string'
          ? chunk
          : decoder.decode(chunk, { stream: true });
      const lines = (pending + text).split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) emit(line);
    },
    flush() {
      emit(pending + decoder.decode());
      pending = '';
    },
  };
};
