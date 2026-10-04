import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { LOG_LEVELS } from '@dolphy-app/engine-contract';
import type {
  ExtensionLogEntryDto,
  LogLevelDto,
} from '@dolphy-app/engine-contract';
import type { LogReadQuery, LogReader } from '../ports/log-reader.ts';

/**
 * Имя файла журнала: `dolphy-ГГГГ-ММ-ДД[.N].log`. Тот же формат пишет
 * `apps/desktop/electron/main/log-file.ts`; порядок файлов — по дате, затем по `N`.
 */
const FILE_NAME = /^dolphy-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.log$/;

/** Остальные поля записи в `details` не длиннее этого. */
export const MAX_DETAILS_CHARS = 4096;
/** Сообщение записи не длиннее этого. */
export const MAX_MESSAGE_CHARS = 4096;

const RANK: Readonly<Record<LogLevelDto, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const isLevel = (value: unknown): value is LogLevelDto =>
  typeof value === 'string' && LOG_LEVELS.includes(value as LogLevelDto);

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;

/** Строка файла → запись; нечитаемая (не JSON, нет `at`, `level` или `message`) — `null`. */
const parseLine = (line: string): ExtensionLogEntryDto | null => {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const { at, level, source, message, extensionId, ...rest } = value as Record<
    string,
    unknown
  >;
  if (
    typeof at !== 'number' ||
    !Number.isFinite(at) ||
    !isLevel(level) ||
    typeof message !== 'string'
  ) {
    return null;
  }
  return {
    at,
    level,
    source: typeof source === 'string' ? source : 'unknown',
    message: clip(message, MAX_MESSAGE_CHARS),
    extensionId: typeof extensionId === 'string' ? extensionId : null,
    details:
      Object.keys(rest).length === 0
        ? null
        : clip(JSON.stringify(rest), MAX_DETAILS_CHARS),
  };
};

const filesNewestFirst = async (dir: string): Promise<string[]> => {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return names
    .flatMap((name) => {
      const match = FILE_NAME.exec(name);
      return match === null
        ? []
        : [{ name, day: match[1] as string, index: Number(match[2] ?? 0) }];
    })
    .sort((a, b) =>
      a.day === b.day ? b.index - a.index : a.day < b.day ? 1 : -1,
    )
    .map(({ name }) => name);
};

/**
 * Читает файлы журнала каталога от новых к старым и собирает последние
 * `limit` подходящих записей; читать дальше, когда набрано, не нужно. Нет
 * каталога — записей нет. Нечитаемый файл и нечитаемые строки пропускаются.
 */
export const createFileLogReader = (dir: string): LogReader => ({
  async read({ extensionId, minLevel, limit }: LogReadQuery) {
    const floor = minLevel === undefined ? 0 : RANK[minLevel];
    const found: ExtensionLogEntryDto[] = [];
    for (const name of await filesNewestFirst(dir)) {
      let text: string;
      try {
        text = await readFile(join(dir, name), 'utf8');
      } catch {
        continue;
      }
      const lines = text.split('\n');
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index] as string;
        if (line === '') continue;
        const entry = parseLine(line);
        if (entry === null || RANK[entry.level] < floor) continue;
        if (extensionId !== undefined && entry.extensionId !== extensionId) {
          continue;
        }
        found.push(entry);
        if (found.length >= limit) return found.reverse();
      }
    }
    return found.reverse();
  },
});
