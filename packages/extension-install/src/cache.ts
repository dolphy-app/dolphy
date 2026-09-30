import path from 'node:path';
import { parseIndex } from '@dolphy-app/extension-catalog';
import type { CatalogIndex } from '@dolphy-app/extension-catalog';
import type { ExtensionLogger } from '@dolphy-app/extension-api';
import { writeAtomic } from './atomic.ts';
import { isMissing } from './fs.ts';
import type { InstallerFs } from './fs.ts';

export interface CachedIndex {
  index: CatalogIndex;
  etag: string | null;
  /** Миллисекунды эпохи. */
  fetchedAt: number;
}

interface Meta {
  etag: string | null;
  fetchedAt: string;
  url: string;
}

export interface CatalogCacheOptions {
  fs: InstallerFs;
  dir: string;
  catalogUrl: string;
  logger: ExtensionLogger;
}

const parseMeta = (raw: unknown): Meta => {
  const record = raw as Partial<Record<keyof Meta, unknown>> | null;
  if (typeof raw !== 'object' || record === null) {
    throw new Error('meta.json is not an object');
  }
  const { etag, fetchedAt, url } = record;
  if (
    (etag !== null && typeof etag !== 'string') ||
    typeof fetchedAt !== 'string' ||
    Number.isNaN(Date.parse(fetchedAt)) ||
    typeof url !== 'string'
  ) {
    throw new Error('meta.json has unexpected fields');
  }
  return { etag, fetchedAt, url };
};

/** Кэш индекса на диске: `index.json` рядом с `meta.json` (ETag, время получения, адрес). */
export const createCatalogCache = (options: CatalogCacheOptions) => {
  const { fs, dir, catalogUrl, logger } = options;
  const indexFile = path.join(dir, 'index.json');
  const metaFile = path.join(dir, 'meta.json');

  const read = async (file: string): Promise<string | null> => {
    try {
      return await fs.readText(file);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  };

  const load = async (): Promise<CachedIndex | null> => {
    try {
      const [metaText, indexText] = await Promise.all([
        read(metaFile),
        read(indexFile),
      ]);
      if (metaText === null || indexText === null) return null;
      const meta = parseMeta(JSON.parse(metaText));
      if (meta.url !== catalogUrl) {
        logger.info({ url: meta.url }, 'catalog cache belongs to another url');
        return null;
      }
      return {
        index: parseIndex(JSON.parse(indexText)),
        etag: meta.etag,
        fetchedAt: Date.parse(meta.fetchedAt),
      };
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      logger.warn({ error }, 'catalog cache ignored: unreadable or corrupt');
      return null;
    }
  };

  const writeMeta = (etag: string | null, fetchedAt: number): Promise<void> => {
    const meta: Meta = {
      etag,
      fetchedAt: new Date(fetchedAt).toISOString(),
      url: catalogUrl,
    };
    return writeAtomic(fs, metaFile, JSON.stringify(meta));
  };

  /** Сбой записи кэша не мешает работе: индекс остаётся в памяти. */
  const persist = async (write: () => Promise<void>): Promise<void> => {
    try {
      await write();
    } catch (error) {
      logger.warn({ error }, 'catalog cache was not saved');
    }
  };

  const save = (
    raw: Uint8Array,
    etag: string | null,
    fetchedAt: number,
  ): Promise<void> =>
    persist(async () => {
      await writeAtomic(fs, indexFile, raw);
      await writeMeta(etag, fetchedAt);
    });

  const touch = (etag: string | null, fetchedAt: number): Promise<void> =>
    persist(() => writeMeta(etag, fetchedAt));

  return { load, save, touch };
};
