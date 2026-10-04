import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export interface TreeFile {
  /** Path from the root, separator `/`. */
  path: string;
  size: number;
}

export interface Tree {
  files: TreeFile[];
  symlinks: string[];
}

export const compareText = (a: string, b: string): number => {
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

export const sha256Of = (data: Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

export const readTree = async (
  root: string,
  skipped: ReadonlySet<string> = new Set(),
): Promise<Tree> => {
  const tree: Tree = { files: [], symlinks: [] };
  const visit = async (prefix: string): Promise<void> => {
    const entries = await readdir(path.join(root, prefix), {
      withFileTypes: true,
    });
    entries.sort((a, b) => compareText(a.name, b.name));
    for (const entry of entries) {
      if (skipped.has(entry.name)) continue;
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) tree.symlinks.push(relative);
      else if (entry.isDirectory()) await visit(relative);
      else {
        const { size } = await lstat(path.join(root, relative));
        tree.files.push({ path: relative, size });
      }
    }
  };
  await visit('');
  return tree;
};

export interface HashedFile extends TreeFile {
  sha256: string;
}

export const hashTree = async (
  root: string,
  files: readonly TreeFile[],
): Promise<HashedFile[]> =>
  Promise.all(
    files.map(async (file) => ({
      ...file,
      sha256: sha256Of(await readFile(path.join(root, file.path))),
    })),
  );
