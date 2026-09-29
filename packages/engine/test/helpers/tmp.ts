/** Временные каталоги тестов: создаются на вызов, удаляются после теста. */
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach } from 'vitest';

export const useTmpDirs = () => {
  const dirs: string[] = [];
  afterEach(async () => {
    // после chmod 000 каталог не удалить: возвращаем права
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });
  return {
    /** Пустой каталог (реальный путь: `/tmp` на macOS — симлинк). */
    make: async (prefix = 'engine-test-') => {
      const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
      dirs.push(dir);
      return dir;
    },
    /** Копия каталога-фикстуры. */
    copy: async (from: string, prefix = 'engine-copy-') => {
      const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
      dirs.push(dir);
      await cp(from, dir, { recursive: true });
      return dir;
    },
  };
};

/** Записывает файлы (`путь → текст`), создавая каталоги. */
export const writeFiles = async (
  root: string,
  files: Readonly<Record<string, string>>,
) => {
  for (const [path, text] of Object.entries(files)) {
    const abs = join(root, path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, text);
  }
};
