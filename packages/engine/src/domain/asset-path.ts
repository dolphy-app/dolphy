/**
 * Разрешение путей ассетов манифестов (spec A.4): семантика `join` из
 * vfs 0.13 и `NormalizePaths` Trane. Чистые строковые функции без I/O,
 * существование файлов не проверяется.
 */
import type {
  BasicAsset,
  CourseManifest,
  ExerciseAsset,
  ExerciseManifest,
  LessonManifest,
} from './manifest.ts';

export class InvalidAssetPathError extends Error {}

const splitComponents = (path: string): string[] =>
  path.split('/').filter((part) => part !== '' && part !== '.');

/**
 * vfs 0.13 `join_internal`: ведущий `/` — от корня библиотеки; `..` у корня
 * зажимается к корню (`escapes = true`); `.` и пустые компоненты пропускаются;
 * завершающий `/` при длине > 1 — ошибка; пустой `path` — сам `dir`.
 * Результат — путь от корня библиотеки без ведущего `/`.
 */
export const resolveAssetPath = (
  dir: string,
  path: string,
): { path: string; escapes: boolean } => {
  if (path.length > 1 && path.endsWith('/')) {
    throw new InvalidAssetPathError(`the path is invalid: '${path}'`);
  }
  const components = path.startsWith('/') ? [] : splitComponents(dir);
  let escapes = false;
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part !== '..') components.push(part);
    else if (components.length > 0) components.pop();
    else escapes = true;
  }
  return { path: components.join('/'), escapes };
};

/**
 * `normalize_path` из data.rs: `libraryRoot` и `manifestRoot` — VFS-пути с
 * ведущим `/` (корень VFS — `''` или `/`). Ошибка, если результат выходит за
 * `libraryRoot`.
 */
export const normalizePath = (
  libraryRoot: string,
  manifestRoot: string,
  path: string,
): string => {
  const { path: relative } = resolveAssetPath(manifestRoot, path);
  const resolved = `/${relative}`;
  const library = libraryRoot.replace(/\/+$/, '');
  if (library === '') return relative;
  const outside = () =>
    new InvalidAssetPathError(
      `asset path ${resolved === '/' ? '' : resolved} is outside the library root`,
    );
  if (!resolved.startsWith(library)) throw outside();
  const remainder = resolved.slice(library.length);
  if (remainder !== '' && !remainder.startsWith('/')) throw outside();
  return remainder.replace(/^\/+/, '');
};

type Normalize = (path: string) => string;

const normalizeBasic = (
  asset: BasicAsset | null,
  normalize: Normalize,
): BasicAsset | null => {
  if (asset === null || !('MarkdownAsset' in asset)) return asset;
  return { MarkdownAsset: { path: normalize(asset.MarkdownAsset.path) } };
};

const normalizeExerciseAsset = (
  asset: ExerciseAsset,
  normalize: Normalize,
): ExerciseAsset => {
  if ('BasicAsset' in asset) {
    const basic = normalizeBasic(asset.BasicAsset, normalize);
    return basic === null ? asset : { BasicAsset: basic };
  }
  if ('FlashcardAsset' in asset) {
    const flashcard = asset.FlashcardAsset;
    return {
      FlashcardAsset: {
        front_path: normalize(flashcard.front_path),
        back_path:
          flashcard.back_path === null ? null : normalize(flashcard.back_path),
      },
    };
  }
  if ('SoundSliceAsset' in asset) {
    const { backup } = asset.SoundSliceAsset;
    return {
      SoundSliceAsset: {
        ...asset.SoundSliceAsset,
        backup: backup === null ? null : normalize(backup),
      },
    };
  }
  return asset;
};

const dirNormalizer =
  (dir: string): Normalize =>
  (path) =>
    resolveAssetPath(dir, path).path;

export const normalizeCourseManifest = (
  m: CourseManifest,
  dir: string,
): CourseManifest => {
  const normalize = dirNormalizer(dir);
  return {
    ...m,
    course_material: normalizeBasic(m.course_material, normalize),
    course_instructions: normalizeBasic(m.course_instructions, normalize),
  };
};

export const normalizeLessonManifest = (
  m: LessonManifest,
  dir: string,
): LessonManifest => {
  const normalize = dirNormalizer(dir);
  return {
    ...m,
    lesson_material: normalizeBasic(m.lesson_material, normalize),
    lesson_instructions: normalizeBasic(m.lesson_instructions, normalize),
  };
};

export const normalizeExerciseManifest = (
  m: ExerciseManifest,
  dir: string,
): ExerciseManifest => ({
  ...m,
  exercise_asset: normalizeExerciseAsset(m.exercise_asset, dirNormalizer(dir)),
});

const basicPaths = (asset: BasicAsset | null): string[] =>
  asset !== null && 'MarkdownAsset' in asset ? [asset.MarkdownAsset.path] : [];

const exerciseAssetPaths = (asset: ExerciseAsset): string[] => {
  if ('BasicAsset' in asset) return basicPaths(asset.BasicAsset);
  if ('FlashcardAsset' in asset) {
    const flashcard = asset.FlashcardAsset;
    return flashcard.back_path === null
      ? [flashcard.front_path]
      : [flashcard.front_path, flashcard.back_path];
  }
  if ('SoundSliceAsset' in asset) {
    const { backup } = asset.SoundSliceAsset;
    return backup === null ? [] : [backup];
  }
  return [];
};

/**
 * Пути файловых ассетов манифеста в порядке `VerifyPaths` Trane (курс/урок:
 * инструкции, затем материал; упражнение — по ассету). Для проверки
 * существования после нормализации.
 */
export const assetPathsOf = (
  m: CourseManifest | LessonManifest | ExerciseManifest,
): string[] => {
  if ('exercise_asset' in m) return exerciseAssetPaths(m.exercise_asset);
  if ('lesson_material' in m) {
    return [
      ...basicPaths(m.lesson_instructions),
      ...basicPaths(m.lesson_material),
    ];
  }
  return [
    ...basicPaths(m.course_instructions),
    ...basicPaths(m.course_material),
  ];
};
