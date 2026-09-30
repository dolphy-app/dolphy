import type { Diagnostic } from '@spirula/engine-contract';
import { createMemoryCourseSource } from '@spirula/testkit';
import { createFileReader } from '../../src/authoring/file-reader.ts';
import type { CourseSource, SourceStat } from '../../src/ports/index.ts';

const EMPTY_LIBRARY = { courses: [], lessons: [], exercises: [] };

/** Библиотека из произвольных файлов (`путь → текст`). */
export const memoryFiles = (files: Record<string, string>) =>
  createMemoryCourseSource(EMPTY_LIBRARY, files);

export const asJson = (value: unknown) => JSON.stringify(value, null, 2);

export interface SourcePatch {
  /** Пути записей каталога, помеченные как символические ссылки. */
  symlinks?: readonly string[];
  /** Подмена полей `stat` по пути. */
  stats?: Readonly<Record<string, Partial<SourceStat>>>;
  /** Пути, чтение которых отвергается (текст и байты). */
  unreadable?: readonly string[];
}

/** Обёртка над источником: симлинки, `outsideRoot`/`realPath`, отказы чтения. */
export const patchSource = (
  source: CourseSource,
  patch: SourcePatch,
): CourseSource => {
  const symlinks = new Set(patch.symlinks ?? []);
  const unreadable = new Set(patch.unreadable ?? []);
  const guard = (path: string) => {
    if (unreadable.has(path)) throw new Error(`EACCES: permission denied`);
  };
  return {
    ...source,
    list: async (dir) => {
      const entries = await source.list(dir);
      return entries.map((entry) =>
        symlinks.has(dir === '' ? entry.name : `${dir}/${entry.name}`)
          ? { ...entry, symlink: true as const }
          : entry,
      );
    },
    readText: async (path) => {
      guard(path);
      return source.readText(path);
    },
    readBytes: async (path) => {
      guard(path);
      return source.readBytes(path);
    },
    stat: async (path) => {
      const info = await source.stat(path);
      const override = patch.stats?.[path];
      return info === null || override === undefined
        ? info
        : { ...info, ...override };
    },
  };
};

export const codesOf = (diagnostics: readonly Diagnostic[]) =>
  diagnostics.map((diagnostic) => diagnostic.code);

export const onlyCode = (diagnostics: readonly Diagnostic[], code: string) =>
  diagnostics.filter((diagnostic) => diagnostic.code === code);

/** Читатель сканера поверх файлов в памяти; диагностики — в `diagnostics`. */
export const readerFor = (
  files: Record<string, string>,
  patch: SourcePatch = {},
) => {
  const diagnostics: Diagnostic[] = [];
  const stats = { files: 0, dirs: 0, bytes: 0, frontFiles: 0 };
  const reader = createFileReader(
    patchSource(memoryFiles(files), patch),
    stats,
    diagnostics,
  );
  return { reader, diagnostics, stats };
};
