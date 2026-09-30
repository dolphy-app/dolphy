import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  OperationDirs,
  SnapshotInstaller,
} from '../ports/repositories.ts';
import { createDirectorySwap } from './directory-swap.ts';
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
  const gitTmpRoot = join(dataDir, GIT_TMP_DIR);
  const stagingRoot = join(libraryRoot, STAGING_DIR);
  const swap = createDirectorySwap({
    targetRoot: repositoriesRoot,
    stagingRoot,
    trashRoot: join(libraryRoot, TRASH_DIR),
  });

  const begin = async (id: string, opId: string): Promise<OperationDirs> => {
    const stagingDir = swap.stagingDir(id, opId);
    const tmpDir = join(gitTmpRoot, opId);
    // остатки прерванной операции с тем же id не смешиваются с новой
    await Promise.all([swap.discard(opId), removeTree(tmpDir)]);
    await mkdir(stagingDir, { recursive: true });
    await mkdir(tmpDir, { recursive: true });
    return { stagingDir, tmpDir };
  };

  const finish = async (opId: string): Promise<void> => {
    await Promise.all([swap.discard(opId), removeTree(join(gitTmpRoot, opId))]);
  };

  const recover = async (): Promise<string[]> => {
    await swap.recover();
    await removeTree(gitTmpRoot);
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
    stagingSource: (opId) => {
      assertSafe('operation id', opId);
      return createNodeFsCourseSource(join(stagingRoot, opId));
    },
    exists: swap.exists,
    install: swap.install,
    rollback: swap.rollback,
    finish,
    remove: async (id) => removeTree(swap.targetDir(id)),
    recover,
  };
};
