import type { CourseSource, SourceEntry, SourceStat } from '@lms/engine';
import { T0_MS } from './clock.ts';
import type { CourseLibrary } from './library.ts';

const ARTIFACT_PATH = '.engine/compiled.json';
const encoder = new TextEncoder();

const lastSegment = (id: string) => id.split('::').at(-1) as string;

/**
 * Раскладывает библиотеку по файлам в раскладке Trane:
 * `<курс>/course_manifest.json`, `<курс>/<урок>/lesson_manifest.json`,
 * `<курс>/<урок>/<упражнение>/exercise_manifest.json`, `front.md`, `back.md`.
 * Имя каталога — последний сегмент id юнита.
 */
export const renderLibrary = (library: CourseLibrary): Map<string, string> => {
  const files = new Map<string, string>();
  const json = (path: string, value: unknown) =>
    files.set(path, `${JSON.stringify(value, null, 2)}\n`);
  for (const course of library.courses) {
    json(`${lastSegment(course.id)}/course_manifest.json`, course);
  }
  for (const lesson of library.lessons) {
    const dir = `${lastSegment(lesson.course_id)}/${lastSegment(lesson.id)}`;
    json(`${dir}/lesson_manifest.json`, lesson);
  }
  for (const exercise of library.exercises) {
    const lessonDir = `${lastSegment(exercise.course_id)}/${lastSegment(exercise.lesson_id)}`;
    const dir = `${lessonDir}/${lastSegment(exercise.id)}`;
    json(`${dir}/exercise_manifest.json`, exercise);
    files.set(`${dir}/front.md`, `Front of ${exercise.id}\n`);
    files.set(`${dir}/back.md`, `Back of ${exercise.id}\n`);
  }
  return files;
};

export interface MemoryCourseSource extends CourseSource {
  /** Снимок файлов (включая артефакт, если он записан). */
  readonly files: ReadonlyMap<string, string>;
}

/**
 * `CourseSource` в памяти. Библиотека — разобранные манифесты
 * (`renderLibrary`) плюс произвольные дополнительные файлы (например,
 * сломанные манифесты для диагностик).
 */
export const createMemoryCourseSource = (
  library: CourseLibrary,
  extraFiles: Readonly<Record<string, string>> = {},
): MemoryCourseSource => {
  const files = renderLibrary(library);
  for (const [path, text] of Object.entries(extraFiles)) files.set(path, text);

  const prefixOf = (dir: string) => (dir === '' ? '' : `${dir}/`);

  const children = (dir: string) => {
    const prefix = prefixOf(dir);
    const found = new Map<string, SourceEntry['kind']>();
    for (const path of files.keys()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash === -1) found.set(rest, 'file');
      else found.set(rest.slice(0, slash), 'directory');
    }
    return found;
  };

  const list = async (dir: string): Promise<readonly SourceEntry[]> => {
    const found = children(dir);
    if (dir !== '' && found.size === 0) {
      throw new Error(`ENOENT: no such directory: ${dir}`);
    }
    return [...found]
      .map(([name, kind]): SourceEntry => ({ name, kind }))
      .sort((a, b) => Number(a.name > b.name) - Number(a.name < b.name));
  };

  const readText = async (path: string) => {
    const text = files.get(path);
    if (text === undefined) throw new Error(`ENOENT: no such file: ${path}`);
    return text;
  };

  const readBytes = async (path: string) =>
    encoder.encode(await readText(path));

  const stat = async (path: string): Promise<SourceStat | null> => {
    const text = files.get(path);
    if (text !== undefined) {
      return {
        kind: 'file',
        bytes: encoder.encode(text).length,
        mtimeMs: T0_MS,
      };
    }
    if (path === '' || children(path).size > 0) {
      return { kind: 'directory', bytes: 0, mtimeMs: T0_MS };
    }
    return null;
  };

  return {
    root: 'memory://library',
    files,
    list,
    readText,
    readBytes,
    stat,
    readArtifact: async () => files.get(ARTIFACT_PATH) ?? null,
    writeArtifact: async (text) => {
      files.set(ARTIFACT_PATH, text);
    },
  };
};
