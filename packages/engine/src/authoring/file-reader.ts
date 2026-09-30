/**
 * Чтение файлов для сканера: один обработчик ошибок (`E_IO`), лимиты размера,
 * защита от выхода за корень и кэш прочитанных байт (`contents` идут в
 * content-revision без повторного чтения).
 */
import type { Diagnostic } from '@spirula-app/engine-contract';
import type { CourseSource, SourceEntry, SourceStat } from '../ports/index.ts';
import { diag } from './diagnostics.ts';
import { lineOfOffset } from './source-lines.ts';

/** Манифест и файл `lesson.*.json` крупнее — `E_IO` (T-15). */
export const MAX_MANIFEST_BYTES = 1024 * 1024;
/** Front-файл и другой Markdown, читаемый сканером. */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

export interface ScanStats {
  files: number;
  dirs: number;
  bytes: number;
  frontFiles: number;
}

export interface ReadOptions {
  unitId?: string;
  /** Предел размера файла, байт; по умолчанию `MAX_MANIFEST_BYTES`. */
  maxBytes?: number;
}

export interface FileReader {
  readonly diagnostics: Diagnostic[];
  readonly stats: ScanStats;
  /** Байты успешно прочитанных файлов по пути от корня библиотеки. */
  readonly contents: ReadonlyMap<string, Uint8Array>;
  /** Записи каталога; `null` (и `E_IO`), если каталог не читается. */
  list(dir: string): Promise<readonly SourceEntry[] | null>;
  /** `stat` с кэшем; `null` — пути нет либо `stat` отказал (`E_IO`). */
  stat(path: string): Promise<SourceStat | null>;
  /**
   * Текст UTF-8 (BOM сохраняется) либо `null` с диагностикой:
   * `E_IO` (нет файла, каталог, лимит, не UTF-8) или `E_ASSET_ESCAPES_ROOT`.
   * Успех и отказ кэшируются: повторное чтение не дублирует диагностику.
   */
  readText(path: string, options?: ReadOptions): Promise<string | null>;
  /**
   * `readText` + `JSON.parse`; `E_JSON_PARSE` несёт файл, строку и юнит.
   * Возвращает и текст (для номеров строк ключей).
   */
  readJson(
    path: string,
    options?: ReadOptions,
  ): Promise<{ text: string; value: unknown } | null>;
}

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Порядок по кодам символов (детерминированный, не зависит от локали). */
export const compareCodeUnits = (a: string, b: string): number => {
  if (a < b) return -1;
  return a > b ? 1 : 0;
};

/** Строка ошибки `JSON.parse` из текста сообщения V8 (`line N` или `position N`). */
const jsonErrorLine = (text: string, message: string) => {
  const byLine = /line (\d+)/.exec(message);
  if (byLine !== null) return Number(byLine[1]);
  const byPosition = /position (\d+)/.exec(message);
  return byPosition === null
    ? undefined
    : lineOfOffset(text, Number(byPosition[1]));
};

/** Число одновременных обращений к источнику (защита от EMFILE). */
const MAX_CONCURRENT_IO = 64;

const createLimiter = (max: number) => {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active < max) active++;
    else {
      await new Promise<void>((wake) => {
        waiting.push(wake); // слот передаётся освободившимся вызовом
      });
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next === undefined) active--;
      else next();
    }
  };
};

export const createFileReader = (
  source: CourseSource,
  stats: ScanStats,
  diagnostics: Diagnostic[],
): FileReader => {
  const contents = new Map<string, Uint8Array>();
  const statCache = new Map<string, Promise<SourceStat | null>>();
  const textCache = new Map<string, Promise<string | null>>();
  const limited = createLimiter(MAX_CONCURRENT_IO);

  const list = async (dir: string) => {
    try {
      const entries = await limited(() => source.list(dir));
      stats.dirs++;
      // порядок обхода — по коду символов имени, независимо от источника
      return [...entries].sort((a, b) => compareCodeUnits(a.name, b.name));
    } catch (error) {
      diagnostics.push(
        diag('E_IO', `cannot list directory: ${messageOf(error)}`, {
          path: dir === '' ? '.' : dir,
        }),
      );
      return null;
    }
  };

  const stat = (path: string) => {
    const cached = statCache.get(path);
    if (cached !== undefined) return cached;
    const pending = limited(() => source.stat(path)).catch((error: unknown) => {
      diagnostics.push(
        diag('E_IO', `cannot stat file: ${messageOf(error)}`, { path }),
      );
      return null;
    });
    statCache.set(path, pending);
    return pending;
  };

  const load = async (
    path: string,
    { unitId, maxBytes = MAX_MANIFEST_BYTES }: ReadOptions,
  ): Promise<string | null> => {
    const at = { path, ...(unitId !== undefined ? { unitId } : {}) };
    const fail = (code: 'E_IO' | 'E_ASSET_ESCAPES_ROOT', message: string) => {
      diagnostics.push(diag(code, message, at));
      return null;
    };
    const tooLarge = (bytes: number) =>
      fail('E_IO', `file too large: ${bytes} bytes, limit ${maxBytes}`);

    const info = await stat(path);
    if (info === null) return fail('E_IO', 'cannot read file: no such file');
    if (info.outsideRoot === true) {
      return fail(
        'E_ASSET_ESCAPES_ROOT',
        'file resolves through a symlink outside the library root; not read',
      );
    }
    if (info.kind === 'directory') {
      return fail('E_IO', 'cannot read file: it is a directory');
    }
    if (info.bytes > maxBytes) return tooLarge(info.bytes);
    let bytes: Uint8Array;
    try {
      bytes = await limited(() => source.readBytes(path));
    } catch (error) {
      return fail('E_IO', `cannot read file: ${messageOf(error)}`);
    }
    if (bytes.byteLength > maxBytes) return tooLarge(bytes.byteLength);
    let text: string;
    try {
      text = decoder.decode(bytes);
    } catch {
      return fail('E_IO', 'cannot read file: it is not valid UTF-8');
    }
    contents.set(path, bytes);
    stats.files++;
    stats.bytes += bytes.byteLength;
    return text;
  };

  const readText = (path: string, options: ReadOptions = {}) => {
    const cached = textCache.get(path);
    if (cached !== undefined) return cached;
    const pending = load(path, options);
    textCache.set(path, pending);
    return pending;
  };

  const readJson = async (path: string, options: ReadOptions = {}) => {
    const text = await readText(path, options);
    if (text === null) return null;
    try {
      return { text, value: JSON.parse(text) as unknown };
    } catch (error) {
      const message = messageOf(error);
      const line = jsonErrorLine(text, message);
      diagnostics.push(
        diag('E_JSON_PARSE', `invalid JSON: ${message}`, {
          path,
          ...(line !== undefined ? { line } : {}),
          ...(options.unitId !== undefined ? { unitId: options.unitId } : {}),
        }),
      );
      return null;
    }
  };

  return { diagnostics, stats, contents, list, stat, readText, readJson };
};
