/**
 * Снимок каталога курса для экспортёра расширения: текстовые файлы дерева
 * курса (путь от каталога курса → содержимое). Расширению пути не нужны:
 * файловую систему читает движок, потому что `ctx.library` перечислить файлы не
 * умеет, а экспорт запускает сам пользователь.
 */
import { MAX_EXTENSION_TRANSFER_BYTES } from '@dolphy-app/engine-contract';
import { scan } from '../authoring/scan.ts';
import type { CourseSource } from '../ports/index.ts';

/** Потолки снимка: те же числа проверяет хост расширений (`EXTENSION_TRANSFER_LIMITS`), иначе кадр каталога не поместился бы в передачу. */
export const COURSE_SNAPSHOT_LIMITS = Object.freeze({
  files: 5000,
  totalBytes: MAX_EXTENSION_TRANSFER_BYTES,
  pathBytes: 1024,
});

/** Каталог курса не помещается в потолки снимка. */
export class CourseSnapshotTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CourseSnapshotTooLargeError';
  }
}

const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();

/** Текстом считается корректный UTF-8 без NUL; остальное (картинки, архивы) в снимок не входит. */
const decodeText = (bytes: Uint8Array): string | null => {
  if (bytes.includes(0)) return null;
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
};

const join = (dir: string, name: string) =>
  dir === '' ? name : `${dir}/${name}`;

/**
 * Текстовые файлы каталога курса. Точечные имена и символические ссылки
 * пропускаются (как сканером библиотеки), файлы вне корня тоже. Превышение
 * потолков — `CourseSnapshotTooLargeError`. `null` — курса нет на диске.
 */
export const readCourseSnapshot = async (
  source: CourseSource,
  courseId: string,
  ignoredPaths: readonly string[],
): Promise<Record<string, string> | null> => {
  // каталог курса — по сканированию библиотеки, как её загружает движок
  const { model } = await scan(source, { ignoredPaths });
  const root = model.courses.find(
    ({ manifest }) => manifest.id === courseId,
  )?.dir;
  if (root === undefined) return null;
  const files: Record<string, string> = {};
  let count = 0;
  let total = 0;

  const add = async (path: string, relative: string): Promise<void> => {
    const info = await source.stat(path);
    if (info === null || info.kind !== 'file' || info.outsideRoot === true) {
      return;
    }
    total += info.bytes;
    if (total > COURSE_SNAPSHOT_LIMITS.totalBytes) {
      throw new CourseSnapshotTooLargeError(
        `course files are longer than ${COURSE_SNAPSHOT_LIMITS.totalBytes} bytes`,
      );
    }
    const text = decodeText(await source.readBytes(path));
    if (text === null) {
      total -= info.bytes;
      return;
    }
    if (
      encoder.encode(relative).byteLength > COURSE_SNAPSHOT_LIMITS.pathBytes
    ) {
      throw new CourseSnapshotTooLargeError(
        `a course path is longer than ${COURSE_SNAPSHOT_LIMITS.pathBytes} bytes`,
      );
    }
    if (++count > COURSE_SNAPSHOT_LIMITS.files) {
      throw new CourseSnapshotTooLargeError(
        `course has more than ${COURSE_SNAPSHOT_LIMITS.files} text files`,
      );
    }
    files[relative] = text;
  };

  const walk = async (dir: string, relativeDir: string): Promise<void> => {
    for (const entry of await source.list(dir)) {
      if (entry.name.startsWith('.') || entry.symlink === true) continue;
      const path = join(dir, entry.name);
      const relative = join(relativeDir, entry.name);
      if (entry.kind === 'directory') await walk(path, relative);
      else await add(path, relative);
    }
  };

  await walk(root, '');
  return files;
};
