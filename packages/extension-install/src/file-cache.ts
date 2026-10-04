import { createHash } from 'node:crypto';
import path from 'node:path';
import type { ExtensionLogger } from '@dolphy-app/extension-api';
import { writeAtomic } from './atomic.ts';
import { isMissing } from './fs.ts';
import type { InstallerFs } from './fs.ts';

/** Потолок дискового кэша файлов версий. */
export const FILE_CACHE_MAX_BYTES = 20 * 1024 * 1024;

const SHA256_NAME = /^[0-9a-f]{64}$/;

export interface FileCacheOptions {
  fs: InstallerFs;
  /** `<extensions>/.catalog/files`. */
  dir: string;
  logger: ExtensionLogger;
  maxBytes?: number;
}

/**
 * Кэш файлов версий, адресованный по содержимому: `<dir>/<sha256>`. Версии неизменны,
 * поэтому запись по хешу никогда не устаревает, а офлайн-режим — просто попадание в кэш.
 */
export const createFileCache = (options: FileCacheOptions) => {
  const { fs, dir, logger } = options;
  const maxBytes = options.maxBytes ?? FILE_CACHE_MAX_BYTES;

  /** Байты записи; повреждённая (хеш не совпал) удаляется и считается промахом. */
  const get = async (sha256: string): Promise<Uint8Array | null> => {
    const file = path.join(dir, sha256);
    let bytes: Uint8Array;
    try {
      bytes = await fs.readBytes(file);
    } catch (error) {
      if (isMissing(error)) return null;
      logger.warn({ error, file }, 'cached version file is unreadable');
      return null;
    }
    if (createHash('sha256').update(bytes).digest('hex') === sha256) {
      return bytes;
    }
    logger.warn({ file }, 'cached version file is corrupt and was dropped');
    await fs.remove(file).catch(() => undefined);
    return null;
  };

  /** Сбой записи не мешает работе: файл просто не будет в кэше. */
  const put = async (sha256: string, bytes: Uint8Array): Promise<void> => {
    try {
      await writeAtomic(fs, path.join(dir, sha256), bytes);
    } catch (error) {
      logger.warn({ error, sha256 }, 'version file was not cached');
    }
  };

  /** Удаляет чужие и временные имена, затем самые старые записи, пока кэш не уложится в потолок. */
  const trim = async (): Promise<void> => {
    try {
      const entries: { name: string; size: number; mtimeMs: number }[] = [];
      for (const name of await fs.list(dir)) {
        const stat = await fs.stat(path.join(dir, name));
        if (stat?.kind === 'file' && SHA256_NAME.test(name)) {
          entries.push({ name, size: stat.size, mtimeMs: stat.mtimeMs });
        } else {
          await fs.remove(path.join(dir, name));
        }
      }
      let total = entries.reduce((sum, entry) => sum + entry.size, 0);
      entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const entry of entries) {
        if (total <= maxBytes) break;
        await fs.remove(path.join(dir, entry.name));
        total -= entry.size;
      }
    } catch (error) {
      logger.warn({ error }, 'version file cache was not trimmed');
    }
  };

  return { get, put, trim };
};

export type FileCache = ReturnType<typeof createFileCache>;
