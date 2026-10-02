import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
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
  const dir = await mkdtemp(path.join(tmpdir(), 'dolphy-ext-tools-'));
  tempDirs.push(dir);
  return dir;
};

/** Делает SDK разрешимым из проекта во временном каталоге (в реальном проекте он стоит в node_modules). */
export const linkSdk = async (root: string): Promise<void> => {
  const scope = path.join(root, 'node_modules', '@dolphy-app');
  await mkdir(scope, { recursive: true });
  await symlink(
    fileURLToPath(new URL('../../extension-sdk', import.meta.url)),
    path.join(scope, 'extension-sdk'),
  );
};

/**
 * Копия фикстурного проекта во временном каталоге (сборка не пишет в
 * репозиторий); SDK разрешим, как в проекте автора. `isLinked: false` — копия
 * без `node_modules`, например чтобы положить проект в репозиторий каталога.
 */
export const copyProject = async (
  name: string,
  { isLinked = true }: { isLinked?: boolean } = {},
): Promise<string> => {
  const dir = path.join(await makeTemp(), name);
  await cp(path.join(projectsDir, name), dir, { recursive: true });
  if (isLinked) await linkSdk(dir);
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
