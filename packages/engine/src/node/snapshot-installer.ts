import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  OperationDirs,
  SnapshotInstaller,
  SnapshotRoot,
} from '../ports/repositories.ts';
import { createDirectorySwap } from './directory-swap.ts';
import { createNodeFsCourseSource } from './fs-course-source.ts';

export interface NodeSnapshotInstallerDeps {
  /** Корень библиотеки: `repositories/`, `imported/`, `.staging/` и `.trash/` лежат в нём. */
  libraryRoot: string;
  /** Каталог данных: временные `gitdir` в `git-tmp/`. */
  dataDir: string;
}

const ROOTS: readonly SnapshotRoot[] = ['repositories', 'imported'];
const STAGING_DIR = '.staging';
const TRASH_DIR = '.trash';
const GIT_TMP_DIR = 'git-tmp';

/** `id` каталога и `opId` операции становятся именами каталогов. */
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

/** Файлов записывается одновременно: дерево импорта — до 5000 файлов. */
const WRITE_BATCH = 32;

/** Относительный путь с `/` без `..`, пустых и начинающихся с точки сегментов, без `\\` и управляющих знаков. */
const isSafeRelativePath = (path: string): boolean =>
  path !== '' &&
  // eslint-disable-next-line no-control-regex
  !/[\\\u0000-\u001f\u007f]/.test(path) &&
  path
    .split('/')
    .every((segment) => segment !== '' && !segment.startsWith('.'));

/**
 * `SnapshotInstaller` поверх `node:fs/promises`. Подмена каталогов — два
 * `rename` внутри одной файловой системы (`libraryRoot`), поэтому `.staging` и
 * `.trash` лежат рядом с `repositories/` и `imported/`, а не в `dataDir`.
 * Корзина у каждого корня своя (`.trash/<root>/<opId>`): без реестра
 * восстановление прерванной подмены не знало бы, куда возвращать каталог.
 */
export const createNodeSnapshotInstaller = ({
  libraryRoot,
  dataDir,
}: NodeSnapshotInstallerDeps): SnapshotInstaller => {
  const gitTmpRoot = join(dataDir, GIT_TMP_DIR);
  const stagingRoot = join(libraryRoot, STAGING_DIR);
  const trashRoot = join(libraryRoot, TRASH_DIR);
  const rootDir = (root: SnapshotRoot) => join(libraryRoot, root);
  const swaps = {
    repositories: createDirectorySwap({
      targetRoot: rootDir('repositories'),
      stagingRoot,
      trashRoot: join(trashRoot, 'repositories'),
    }),
    imported: createDirectorySwap({
      targetRoot: rootDir('imported'),
      stagingRoot,
      trashRoot: join(trashRoot, 'imported'),
    }),
  };
  // `.staging/<opId>/<id>` одинаков у обоих корней
  const staging = swaps.repositories;

  const finish = async (opId: string): Promise<void> => {
    await Promise.all([
      ...ROOTS.map((root) => swaps[root].discard(opId)),
      removeTree(join(gitTmpRoot, opId)),
    ]);
  };

  const begin = async (
    root: SnapshotRoot,
    id: string,
    opId: string,
  ): Promise<OperationDirs> => {
    const stagingDir = swaps[root].stagingDir(id, opId);
    const tmpDir = join(gitTmpRoot, opId);
    // остатки прерванной операции с тем же id не смешиваются с новой
    await Promise.all([finish(opId), removeTree(tmpDir)]);
    await mkdir(stagingDir, { recursive: true });
    await mkdir(tmpDir, { recursive: true });
    return { stagingDir, tmpDir };
  };

  const writeStaging = async (
    id: string,
    opId: string,
    files: Readonly<Record<string, string>>,
  ): Promise<void> => {
    const base = staging.stagingDir(id, opId);
    const entries = Object.entries(files);
    const seen = new Set<string>();
    for (const [path] of entries) {
      if (!isSafeRelativePath(path)) {
        throw new Error(`Unsafe file path: ${JSON.stringify(path)}`);
      }
      const folded = path.toLowerCase();
      if (seen.has(folded)) {
        throw new Error(`Duplicate file path: ${JSON.stringify(path)}`);
      }
      seen.add(folded);
    }
    for (let at = 0; at < entries.length; at += WRITE_BATCH) {
      await Promise.all(
        entries.slice(at, at + WRITE_BATCH).map(async ([path, text]) => {
          const target = join(base, ...path.split('/'));
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, text, 'utf8');
        }),
      );
    }
  };

  const recover = async (): Promise<Record<SnapshotRoot, string[]>> => {
    for (const root of ROOTS) await swaps[root].recover();
    await Promise.all([removeTree(trashRoot), removeTree(gitTmpRoot)]);
    const listed = {} as Record<SnapshotRoot, string[]>;
    for (const root of ROOTS) {
      try {
        const entries = await readdir(rootDir(root), { withFileTypes: true });
        listed[root] = entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort();
      } catch (error) {
        if (!isMissing(error)) throw error;
        listed[root] = [];
      }
    }
    return listed;
  };

  return {
    snapshotPath: (root, id) => {
      assertSafe('directory id', id);
      return `${root}/${id}`;
    },
    begin,
    writeStaging,
    stagingSource: (opId) => {
      assertSafe('operation id', opId);
      return createNodeFsCourseSource(join(stagingRoot, opId));
    },
    exists: (root, id) => swaps[root].exists(id),
    install: (root, id, opId) => swaps[root].install(id, opId),
    rollback: (root, id, opId) => swaps[root].rollback(id, opId),
    finish,
    remove: async (root, id) => removeTree(swaps[root].targetDir(id)),
    recover,
  };
};
