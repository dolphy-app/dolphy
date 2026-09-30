import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface DirectorySwapDeps {
  /** Корень установленных каталогов: `<targetRoot>/<name>`. */
  targetRoot: string;
  /** Корень подготовки: `<stagingRoot>/<opId>/<name>`. */
  stagingRoot: string;
  /** Корень прежних версий: `<trashRoot>/<opId>/<name>`. */
  trashRoot: string;
}

export interface DirectorySwap {
  /** Подменяет `targetRoot/<name>` содержимым `stagingRoot/<opId>/<name>`. */
  install: (name: string, opId: string) => Promise<void>;
  /** Возвращает прежний каталог из корзины операции (или удаляет новый). */
  rollback: (name: string, opId: string) => Promise<void>;
  /** Удаляет staging и корзину операции. */
  discard: (opId: string) => Promise<void>;
  /** Восстанавливает прерванные подмены и чистит staging и корзину. */
  recover: () => Promise<void>;
  stagingDir: (name: string, opId: string) => string;
  targetDir: (name: string) => string;
  exists: (name: string) => Promise<boolean>;
}

/** `name` и `opId` становятся именами каталогов. */
const SAFE_NAME = /^[a-z0-9._-]+$/;

const assertSafe = (kind: string, name: string): void => {
  // `.` и `..` проходят по алфавиту, но выводят из каталога
  if (!SAFE_NAME.test(name) || /^\.+$/.test(name)) {
    throw new Error(`Unsafe ${kind}: ${JSON.stringify(name)}`);
  }
};

const isMissing = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException).code === 'ENOENT';

const pathExists = async (path: string): Promise<boolean> => {
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
 * Crash-safe подмена каталога: два `rename` внутри одной файловой системы.
 * Все три корня должны лежать на одном томе.
 */
export const createDirectorySwap = ({
  targetRoot,
  stagingRoot,
  trashRoot,
}: DirectorySwapDeps): DirectorySwap => {
  const targetDir = (name: string) => {
    assertSafe('directory name', name);
    return join(targetRoot, name);
  };
  const stagingDir = (name: string, opId: string) => {
    assertSafe('operation id', opId);
    assertSafe('directory name', name);
    return join(stagingRoot, opId, name);
  };
  const trashDir = (name: string, opId: string) => {
    assertSafe('operation id', opId);
    assertSafe('directory name', name);
    return join(trashRoot, opId, name);
  };

  const install = async (name: string, opId: string): Promise<void> => {
    const dest = targetDir(name);
    const source = stagingDir(name, opId);
    const trash = trashDir(name, opId);
    await mkdir(targetRoot, { recursive: true });
    const replaced = await pathExists(dest);
    if (replaced) {
      await mkdir(join(trashRoot, opId), { recursive: true });
      await rename(dest, trash);
    }
    try {
      await rename(source, dest);
    } catch (error) {
      // старый каталог возвращается на место, новый остаётся в staging
      if (replaced) await rename(trash, dest);
      throw error;
    }
  };

  const rollback = async (name: string, opId: string): Promise<void> => {
    const dest = targetDir(name);
    const trash = trashDir(name, opId);
    await removeTree(dest);
    if (await pathExists(trash)) await rename(trash, dest);
  };

  const discard = async (opId: string): Promise<void> => {
    assertSafe('operation id', opId);
    await Promise.all([
      removeTree(join(stagingRoot, opId)),
      removeTree(join(trashRoot, opId)),
    ]);
  };

  /**
   * Прерванная подмена (между двумя `rename`): прежний каталог лежит в
   * корзине, а в `targetRoot` его нет — возвращаем его.
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
      for (const name of await readdir(opDir)) {
        if (!SAFE_NAME.test(name)) continue;
        const dest = join(targetRoot, name);
        if (await pathExists(dest)) continue;
        await mkdir(targetRoot, { recursive: true });
        await rename(join(opDir, name), dest);
      }
    }
  };

  const recover = async (): Promise<void> => {
    await restoreTrashed();
    await Promise.all([removeTree(stagingRoot), removeTree(trashRoot)]);
  };

  return {
    install,
    rollback,
    discard,
    recover,
    stagingDir,
    targetDir,
    exists: async (name) => pathExists(targetDir(name)),
  };
};
