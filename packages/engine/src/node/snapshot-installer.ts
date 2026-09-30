import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  OperationDirs,
  SnapshotInstaller,
} from '../ports/repositories.ts';
import { createNodeFsCourseSource } from './fs-course-source.ts';

export interface NodeSnapshotInstallerDeps {
  /** Корень библиотеки: `repositories/`, `.staging/` и `.trash/` лежат в нём. */
  libraryRoot: string;
  /** Каталог данных: временные `gitdir` в `git-tmp/`. */
  dataDir: string;
}

const REPOSITORIES_DIR = 'repositories';
const STAGING_DIR = '.staging';
const TRASH_DIR = '.trash';
const GIT_TMP_DIR = 'git-tmp';

/** `id` репозитория и `opId` операции становятся именами каталогов. */
const SAFE_NAME = /^[a-z0-9._-]+$/;

const assertSafe = (kind: string, name: string): void => {
  // `.` и `..` проходят по алфавиту, но выводят из каталога
  if (!SAFE_NAME.test(name) || /^\.+$/.test(name)) {
    throw new Error(`Unsafe ${kind}: ${JSON.stringify(name)}`);
  }
};

const isMissing = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException).code === 'ENOENT';

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
};

const removeTree = (path: string) => rm(path, { recursive: true, force: true });

/**
 * `SnapshotInstaller` поверх `node:fs/promises`. Подмена каталогов — два
 * `rename` внутри одной файловой системы (`libraryRoot`), поэтому `.staging` и
 * `.trash` лежат рядом с `repositories/`, а не в `dataDir`.
 */
export const createNodeSnapshotInstaller = ({
  libraryRoot,
  dataDir,
}: NodeSnapshotInstallerDeps): SnapshotInstaller => {
  const repositoriesRoot = join(libraryRoot, REPOSITORIES_DIR);
  const stagingRoot = join(libraryRoot, STAGING_DIR);
  const trashRoot = join(libraryRoot, TRASH_DIR);
  const gitTmpRoot = join(dataDir, GIT_TMP_DIR);

  const target = (id: string) => {
    assertSafe('repository id', id);
    return join(repositoriesRoot, id);
  };
  const staging = (opId: string) => {
    assertSafe('operation id', opId);
    return join(stagingRoot, opId);
  };
  const trashed = (id: string, opId: string) => {
    assertSafe('operation id', opId);
    assertSafe('repository id', id);
    return join(trashRoot, opId, id);
  };

  const begin = async (opId: string): Promise<OperationDirs> => {
    const stagingDir = staging(opId);
    assertSafe('operation id', opId);
    const tmpDir = join(gitTmpRoot, opId);
    // остатки прерванной операции с тем же id не смешиваются с новой
    await Promise.all([removeTree(stagingDir), removeTree(tmpDir)]);
    await mkdir(stagingDir, { recursive: true });
    await mkdir(tmpDir, { recursive: true });
    return { stagingDir, tmpDir };
  };

  const install = async (id: string, opId: string): Promise<void> => {
    const dest = target(id);
    const source = staging(opId);
    const trash = trashed(id, opId);
    await mkdir(repositoriesRoot, { recursive: true });
    const replaced = await exists(dest);
    if (replaced) {
      await mkdir(join(trashRoot, opId), { recursive: true });
      await rename(dest, trash);
    }
    try {
      await rename(source, dest);
    } catch (error) {
      // старый снимок возвращается на место, новый остаётся в staging
      if (replaced) await rename(trash, dest);
      throw error;
    }
  };

  const rollback = async (id: string, opId: string): Promise<void> => {
    const dest = target(id);
    const trash = trashed(id, opId);
    await removeTree(dest);
    if (await exists(trash)) await rename(trash, dest);
  };

  const finish = async (opId: string): Promise<void> => {
    await Promise.all([
      removeTree(staging(opId)),
      removeTree(join(trashRoot, opId)),
      removeTree(join(gitTmpRoot, opId)),
    ]);
  };

  /**
   * Прерванная подмена (между двумя `rename`): прежний снимок лежит в
   * `.trash`, а `repositories/<id>` нет — возвращаем его, иначе запись
   * реестра осталась бы без каталога.
   */
  const restoreTrashed = async (): Promise<void> => {
    let ops: string[];
    try {
      ops = await readdir(trashRoot);
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    for (const opId of ops) {
      const opDir = join(trashRoot, opId);
      for (const id of await readdir(opDir)) {
        if (!SAFE_NAME.test(id)) continue;
        const dest = join(repositoriesRoot, id);
        if (await exists(dest)) continue;
        await mkdir(repositoriesRoot, { recursive: true });
        await rename(join(opDir, id), dest);
      }
    }
  };

  const recover = async (): Promise<string[]> => {
    await restoreTrashed();
    await Promise.all([
      removeTree(stagingRoot),
      removeTree(trashRoot),
      removeTree(gitTmpRoot),
    ]);
    try {
      const entries = await readdir(repositoriesRoot, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  };

  return {
    snapshotPath: (id) => {
      assertSafe('repository id', id);
      return `${REPOSITORIES_DIR}/${id}`;
    },
    begin,
    stagingSource: (opId) => createNodeFsCourseSource(staging(opId)),
    exists: async (id) => exists(target(id)),
    install,
    rollback,
    finish,
    remove: async (id) => removeTree(target(id)),
    recover,
  };
};
