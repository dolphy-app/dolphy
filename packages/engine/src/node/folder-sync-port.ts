import { readFile, realpath, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { EngineConfig } from '@spirula/engine-contract';
import type { FolderSyncPort } from '../app/context.ts';
import { EngineError } from '../app/errors.ts';
import type { Logger } from '../ports/index.ts';
import { writeTextAtomic } from './atomic-write.ts';
import { createFolderSync } from './folder-sync.ts';

export interface NodeFolderSyncPortDeps {
  logger?: Logger;
}

const SETTINGS_DIR = 'settings';
const SYNC_FILE = 'sync.json';

const invalidDir = (dir: string, reason: string) =>
  new EngineError('INVALID_ARGUMENT', {
    message: `Sync folder is not usable: ${reason}`,
    details: { field: 'dir', dir, reason },
  });

const isMissing = (error: unknown) =>
  (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';

const realOrResolved = async (path: string) => {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch (error) {
    if (isMissing(error)) return absolute;
    throw error;
  }
};

/**
 * Порт общей папки: запоминает каталог в `dataDir/settings/sync.json`,
 * отсекает `dataDir` (он же каталог БД) и его подкаталоги.
 */
export const createNodeFolderSyncPort = (
  config: Pick<EngineConfig, 'dataDir'>,
  { logger }: NodeFolderSyncPortDeps = {},
): FolderSyncPort => {
  const file = join(config.dataDir, SETTINGS_DIR, SYNC_FILE);

  const load = async (): Promise<string | null> => {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      logger?.warn({ file, error }, 'sync.json is not valid JSON, ignored');
      return null;
    }
    const dir = (parsed as { dir?: unknown } | null)?.dir;
    if (typeof dir === 'string' && dir !== '') return dir;
    logger?.warn({ file }, 'sync.json has no folder path, ignored');
    return null;
  };

  const save = async (dir: string): Promise<void> => {
    if (typeof dir !== 'string' || dir === '') {
      throw invalidDir(String(dir), 'empty');
    }
    const absolute = resolve(dir);
    let info;
    try {
      info = await stat(absolute);
    } catch (error) {
      if (isMissing(error)) throw invalidDir(dir, 'not-found');
      throw error;
    }
    if (!info.isDirectory()) throw invalidDir(dir, 'not-a-directory');
    const real = await realpath(absolute);
    const dataReal = await realOrResolved(config.dataDir);
    if (real === dataReal) throw invalidDir(dir, 'is-data-dir');
    if (real.startsWith(dataReal + sep)) {
      throw invalidDir(dir, 'inside-data-dir');
    }
    await writeTextAtomic(
      file,
      `${JSON.stringify({ dir: absolute }, null, 2)}\n`,
    );
  };

  return { load, save, open: createFolderSync };
};
