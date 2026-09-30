import type { SourceStat } from '@spirula-app/engine/ports';

export interface FilesSource {
  readText(path: string): Promise<string>;
  stat(path: string): Promise<SourceStat | null>;
}

export interface MutableFiles extends FilesSource {
  set(path: string, text: string): void;
  readonly reads: string[];
}

/** Минимальный источник библиотеки в памяти: файлы правятся по ходу теста. */
export const createFilesSource = (
  initial: Readonly<Record<string, string>>,
): MutableFiles => {
  const files = new Map(Object.entries(initial));
  const versions = new Map<string, number>();
  const reads: string[] = [];
  return {
    reads,
    set: (path, text) => {
      files.set(path, text);
      versions.set(path, (versions.get(path) ?? 0) + 1);
    },
    readText: async (path) => {
      const text = files.get(path);
      if (text === undefined) throw new Error(`ENOENT: ${path}`);
      reads.push(path);
      return text;
    },
    stat: async (path) => {
      const text = files.get(path);
      if (text === undefined) return null;
      return {
        kind: 'file',
        bytes: Buffer.byteLength(text),
        mtimeMs: versions.get(path) ?? 0,
      };
    },
  };
};
