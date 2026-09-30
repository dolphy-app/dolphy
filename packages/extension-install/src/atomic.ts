import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { InstallerFs } from './fs.ts';

export const randomSuffix = (): string => randomBytes(4).toString('hex');

/** Запись во временный файл и `rename`: читатель видит либо старое, либо новое содержимое. */
export const writeAtomic = async (
  fs: InstallerFs,
  file: string,
  data: string | Uint8Array,
): Promise<void> => {
  await fs.mkdir(path.dirname(file));
  const temporary = `${file}.${randomSuffix()}.tmp`;
  try {
    await fs.writeFile(temporary, data);
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.remove(temporary).catch(() => undefined);
    throw error;
  }
};
