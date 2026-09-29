/** Временные каталоги теста: создаются на вызов, удаляются после теста. */
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';

export const useTmpDir = () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });
  return {
    make: async (prefix = 'sql-runner-test-'): Promise<string> => {
      const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
      dirs.push(dir);
      return dir;
    },
  };
};
