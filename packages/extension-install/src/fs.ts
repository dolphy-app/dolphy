import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';

export interface EntryStat {
  kind: 'directory' | 'file' | 'symlink' | 'other';
  mtimeMs: number;
}

/** Файловые операции установщика; внедряются, чтобы тесты могли ломать отдельные шаги. */
export interface InstallerFs {
  /** Рекурсивно создаёт каталог. */
  mkdir(dir: string): Promise<void>;
  readText(file: string): Promise<string>;
  writeFile(file: string, data: string | Uint8Array): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Рекурсивно удаляет; отсутствие пути — не ошибка. Символические ссылки не разыменовываются. */
  remove(target: string): Promise<void>;
  /** Имена записей каталога; нет каталога — пусто. */
  list(dir: string): Promise<string[]>;
  /** Без разыменования ссылок; нет пути — `null`. */
  stat(target: string): Promise<EntryStat | null>;
}

export const isMissing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

const kindOf = (
  stats: Awaited<ReturnType<typeof lstat>>,
): EntryStat['kind'] => {
  if (stats.isSymbolicLink()) return 'symlink';
  if (stats.isDirectory()) return 'directory';
  return stats.isFile() ? 'file' : 'other';
};

export const nodeFs: InstallerFs = {
  mkdir: async (dir) => {
    await mkdir(dir, { recursive: true });
  },
  readText: (file) => readFile(file, 'utf8'),
  writeFile: (file, data) => writeFile(file, data),
  rename,
  remove: (target) => rm(target, { recursive: true, force: true }),
  list: async (dir) => {
    try {
      return await readdir(dir);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  },
  stat: async (target) => {
    try {
      const stats = await lstat(target);
      return { kind: kindOf(stats), mtimeMs: stats.mtimeMs };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  },
};
