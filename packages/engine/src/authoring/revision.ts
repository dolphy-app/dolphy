/**
 * Отпечатки библиотеки: content-`revision` (sha256 по байтам всех входных
 * файлов — источник истины о свежести) и `statFingerprint` (быстрый путь без
 * чтения). Порядок путей, разделители и состав входов — часть `formatVersion`
 * артефакта (report-compiler.md §6).
 */
import type { CourseSource, SourceEntry } from '../ports/index.ts';

export interface InputFile {
  /** Путь от корня библиотеки, разделитель `/`. */
  path: string;
  size: number;
  mtimeMs: number;
  ctimeMs?: number;
  ino?: number;
}

export interface InputBytes {
  path: string;
  bytes: Uint8Array;
}

/** Одновременных чтений: предел открытых дескрипторов. */
const READ_CONCURRENCY = 64;

const encoder = new TextEncoder();
const compare = (a: string, b: string) => Number(a > b) - Number(a < b);

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');

/** sha256 в hex через Web Crypto (без `node:crypto`: слой чистый). */
export const sha256Hex = async (data: Uint8Array): Promise<string> =>
  // DOM-типы (окно, TS 6) требуют Uint8Array<ArrayBuffer>; байты всегда из ArrayBuffer
  toHex(
    await globalThis.crypto.subtle.digest(
      'SHA-256',
      data as Uint8Array<ArrayBuffer>,
    ),
  );

/** `mapper` над `items` не более чем в `limit` потоков; порядок результата — порядок входа. */
const mapPool = async <T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await mapper(items[i] as T);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
};

/**
 * Входные файлы компилятора: всё, кроме dot-каталогов (`.engine`, `.git`) и
 * путей из `exclude`. Симлинки за корнем не входят (сканер сообщает о них
 * `E_ASSET_ESCAPES_ROOT`); петли по симлинкам обрываются по `realPath`.
 * Отсортированы по коду символов UTF-16.
 */
export const listInputs = async (
  source: CourseSource,
  exclude: readonly string[] = [],
): Promise<InputFile[]> => {
  const excluded = new Set(exclude);
  const visitedTargets = new Set<string>();
  const files: InputFile[] = [];

  /** Каталоги под `dir`, в которые нужно спуститься; файлы попадают в `files`. */
  const inspect = async (dir: string, entry: SourceEntry) => {
    const path = dir === '' ? entry.name : `${dir}/${entry.name}`;
    const isDirectory = entry.kind === 'directory';
    if (isDirectory && entry.name.startsWith('.')) return [];
    if (isDirectory && entry.symlink !== true) return [path];
    const stat = await source.stat(path);
    if (stat === null || stat.outsideRoot === true) return [];
    if (isDirectory) {
      const { realPath } = stat;
      if (realPath === undefined) return [path];
      if (visitedTargets.has(realPath)) return [];
      visitedTargets.add(realPath);
      return [path];
    }
    if (!excluded.has(path)) {
      files.push({
        path,
        size: stat.bytes,
        mtimeMs: stat.mtimeMs,
        ...(stat.ctimeMs !== undefined ? { ctimeMs: stat.ctimeMs } : {}),
        ...(stat.ino !== undefined ? { ino: stat.ino } : {}),
      });
    }
    return [];
  };

  const walk = async (dir: string): Promise<void> => {
    const entries = await source.list(dir);
    const found = await Promise.all(entries.map((e) => inspect(dir, e)));
    await Promise.all(found.flat().map(walk));
  };

  await walk('');
  return files.sort((a, b) => compare(a.path, b.path));
};

/**
 * Байты входов: файлы из `known` (их уже прочёл сканер) повторно не читаются,
 * остальные — `source.readBytes`. Порядок — порядок `files`.
 */
export const readInputBytes = (
  source: CourseSource,
  files: readonly InputFile[],
  known: ReadonlyMap<string, Uint8Array> = new Map(),
): Promise<InputBytes[]> =>
  mapPool(files, READ_CONCURRENCY, async ({ path }) => ({
    path,
    bytes: known.get(path) ?? (await source.readBytes(path)),
  }));

/**
 * sha256 по отсортированным (UTF-16) `path\0length\0bytes`, где `length` —
 * число байт файла; всё склеивается в один буфер.
 */
export const contentRevision = (
  files: readonly InputBytes[],
): Promise<string> => {
  const sorted = [...files].sort((a, b) => compare(a.path, b.path));
  const heads = sorted.map(({ path, bytes }) =>
    encoder.encode(`${path}\0${bytes.length}\0`),
  );
  let total = 0;
  sorted.forEach(({ bytes }, i) => {
    total += (heads[i] as Uint8Array).length + bytes.length;
  });
  const buffer = new Uint8Array(total);
  let offset = 0;
  sorted.forEach(({ bytes }, i) => {
    const head = heads[i] as Uint8Array;
    buffer.set(head, offset);
    buffer.set(bytes, offset + head.length);
    offset += head.length + bytes.length;
  });
  return sha256Hex(buffer);
};

/**
 * sha256 по `(path, size, mtimeMs, ctimeMs, ino)` входов в порядке путей:
 * `ctime` и `ino` пользовательские инструменты (`touch -r`, `cp -p`, sync)
 * восстановить не могут. Сравнивать только на равенство.
 */
export const statFingerprint = (
  files: readonly InputFile[],
): Promise<string> => {
  const sorted = [...files].sort((a, b) => compare(a.path, b.path));
  const lines = sorted.map(
    (f) =>
      `${f.path}\0${f.size}\0${f.mtimeMs}\0${f.ctimeMs ?? ''}\0${f.ino ?? ''}\n`,
  );
  return sha256Hex(encoder.encode(lines.join('')));
};
