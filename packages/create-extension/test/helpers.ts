import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';

const temps: string[] = [];

/** Временный каталог, удаляемый после каждого теста. */
export const makeTemp = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'create-ext-'));
  temps.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(
    temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

export const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
