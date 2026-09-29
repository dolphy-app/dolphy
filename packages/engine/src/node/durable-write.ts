import { randomBytes } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

const IGNORED_DIR_FSYNC = ['EISDIR', 'EPERM', 'EINVAL', 'EACCES'];

/** `fsync` каталога: без него `rename` может пропасть при потере питания. */
export const syncDirectory = async (dir: string) => {
  let handle;
  try {
    handle = await open(dir, 'r');
    await handle.sync();
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (!code || !IGNORED_DIR_FSYNC.includes(code)) throw error;
  } finally {
    await handle?.close();
  }
};

/**
 * Временный файл в том же каталоге → `fsync` → атомарный `rename` → `fsync`
 * каталога. Читатель видит либо старое содержимое, либо новое целиком.
 */
export const writeFileDurable = async (
  path: string,
  data: string | Uint8Array,
  { dirFsync = true }: { dirFsync?: boolean } = {},
) => {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    const handle = await open(tmp, 'w');
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
  if (dirFsync) await syncDirectory(dir);
};
