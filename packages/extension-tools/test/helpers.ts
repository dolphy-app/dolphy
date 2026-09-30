import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'vitest';

const projectsDir = fileURLToPath(
  new URL('./fixtures/projects', import.meta.url),
);

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

export const makeTemp = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'spirula-ext-tools-'));
  tempDirs.push(dir);
  return dir;
};

/** Копия фикстурного проекта во временном каталоге (сборка не пишет в репозиторий). */
export const copyProject = async (name: string): Promise<string> => {
  const dir = path.join(await makeTemp(), name);
  await cp(path.join(projectsDir, name), dir, { recursive: true });
  return dir;
};

export const waitFor = async (
  check: () => Promise<boolean>,
  timeoutMs = 30_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('waitFor: timed out');
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
  }
};
