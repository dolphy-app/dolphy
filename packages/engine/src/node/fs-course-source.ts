import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import type { CourseSource, SourceEntry, SourceStat } from '../ports/index.ts';
import { writeTextAtomic } from './atomic-write.ts';

const ARTIFACT_PATH = '.engine/compiled.json';

/** Срок жизни кэша реальных путей каталогов. */
const REAL_DIRS_TTL_MS = 100;

/** Ошибки ФС, означающие «пути нет» (в том числе висячая ссылка и петля). */
const MISSING_CODES: Record<string, true> = {
  ENOENT: true,
  ENOTDIR: true,
  ELOOP: true,
};

const isMissing = (error: unknown) =>
  MISSING_CODES[(error as NodeJS.ErrnoException).code ?? ''] === true;

const compareCodeUnits = (a: string, b: string) => {
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

const kindOf = (s: {
  isFile(): boolean;
  isDirectory(): boolean;
}): SourceEntry['kind'] | null => {
  if (s.isFile()) return 'file';
  return s.isDirectory() ? 'directory' : null;
};

export type NodeFsCourseSource = CourseSource;

/**
 * `CourseSource` поверх `node:fs/promises`. Пути порта относительны корня;
 * выход за корень (`..`, абсолютный путь) отвергается до обращения к ФС.
 * Принадлежность символических ссылок корню считается по каталогам и
 * кэшируется: `realpath` на каждый файл на 40 тыс. файлов слишком дорог.
 */
export const createNodeFsCourseSource = (root: string): CourseSource => {
  const rootAbs = resolve(root);
  const rootPrefix = rootAbs.endsWith(sep) ? rootAbs : rootAbs + sep;
  let realRootPromise: Promise<string> | undefined;
  const realRoot = () => (realRootPromise ??= realpath(rootAbs));
  // реальный путь каталога по его пути в библиотеке; кэш живёт недолго:
  // при обходе он экономит `realpath`, а подмена каталога симлинком в
  // долгоживущем источнике не остаётся незамеченной
  const realDirs = new Map<string, Promise<string>>();

  const absolute = (path: string) => {
    const abs = resolve(rootAbs, path);
    if (abs !== rootAbs && !abs.startsWith(rootPrefix)) {
      throw new Error(`Path escapes the library root: ${path}`);
    }
    return abs;
  };

  const parentOf = (path: string) => {
    const slash = path.lastIndexOf('/');
    return slash === -1 ? '' : path.slice(0, slash);
  };

  const realDirOf = (dir: string): Promise<string> => {
    const cached = realDirs.get(dir);
    if (cached !== undefined) return cached;
    const pending = (async () => {
      if (dir === '') return realRoot();
      const abs = absolute(dir);
      const link = await lstat(abs);
      if (link.isSymbolicLink()) return realpath(abs);
      return join(await realDirOf(parentOf(dir)), basename(abs));
    })();
    if (realDirs.size === 0) {
      setTimeout(() => realDirs.clear(), REAL_DIRS_TTL_MS).unref();
    }
    realDirs.set(dir, pending);
    // неудачу не кэшируем: каталог может появиться позже
    pending.catch(() => realDirs.delete(dir));
    return pending;
  };

  /** Реальный путь не-ссылки: реальный каталог родителя + имя (без `realpath`). */
  const realOf = async (path: string, abs: string) => {
    if (path === '') return realRoot();
    return join(await realDirOf(parentOf(path)), basename(abs));
  };

  const isInside = (real: string, realRootPath: string) =>
    real === realRootPath || real.startsWith(realRootPath + sep);

  const list = async (dir: string): Promise<readonly SourceEntry[]> => {
    const abs = absolute(dir);
    const dirents = await readdir(abs, { withFileTypes: true });
    const entries: SourceEntry[] = [];
    for (const dirent of dirents) {
      if (dirent.isSymbolicLink()) {
        try {
          const kind = kindOf(await stat(join(abs, dirent.name)));
          if (kind !== null) {
            entries.push({ name: dirent.name, kind, symlink: true });
          }
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
        continue;
      }
      const kind = kindOf(dirent);
      if (kind !== null) entries.push({ name: dirent.name, kind });
    }
    return entries.sort((a, b) => compareCodeUnits(a.name, b.name));
  };

  const readText = async (path: string) => readFile(absolute(path), 'utf8');

  const readBytes = async (path: string): Promise<Uint8Array> => {
    const buffer = await readFile(absolute(path));
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  };

  const statPath = async (path: string): Promise<SourceStat | null> => {
    const abs = absolute(path);
    try {
      const link = await lstat(abs);
      const isLink = link.isSymbolicLink();
      const target = isLink ? await stat(abs) : link;
      const kind = kindOf(target);
      if (kind === null) return null;
      const root = await realRoot();
      const real = isLink ? await realpath(abs) : await realOf(path, abs);
      const lexical = path === '' ? root : join(root, ...path.split('/'));
      const result: SourceStat = {
        kind,
        bytes: kind === 'file' ? target.size : 0,
        mtimeMs: target.mtimeMs,
        ctimeMs: target.ctimeMs,
        ino: target.ino,
      };
      if (!isInside(real, root)) result.outsideRoot = true;
      if (real !== lexical) result.realPath = real;
      return result;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  };

  const readArtifact = async () => {
    try {
      return await readFile(absolute(ARTIFACT_PATH), 'utf8');
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  };

  const writeArtifact = async (text: string) =>
    writeTextAtomic(absolute(ARTIFACT_PATH), text);

  return {
    root: rootAbs,
    list,
    readText,
    readBytes,
    stat: statPath,
    readArtifact,
    writeArtifact,
  };
};
