/**
 * Чтение ассета библиотеки по `AssetRef`, выданному движком (engine-ts-api.md §3).
 * Курс недоверенный: ссылка должна быть путём ассета своего юнита, файл — внутри
 * корня (в том числе после симлинков), размер — не больше 2 МБ.
 */
import type { AssetContent, AssetRef } from '@lms/engine-contract';
import { EngineError } from '../app/errors.ts';
import { assetPathsOf, resolveAssetPath } from '../domain/asset-path.ts';
import type { Library } from '../domain/library.ts';
import type { CourseSource } from '../ports/index.ts';
import { stripFrontmatter } from './frontmatter.ts';

export const MAX_ASSET_BYTES = 2 * 1024 * 1024;

const outsideLibrary = (ref: AssetRef, reason: string) =>
  new EngineError('ASSET_OUTSIDE_LIBRARY', {
    details: { unitId: ref.unitId, path: ref.path, reason },
  });

const tooLarge = (ref: AssetRef, bytes: number) =>
  new EngineError('ASSET_TOO_LARGE', {
    details: {
      unitId: ref.unitId,
      path: ref.path,
      bytes,
      max: MAX_ASSET_BYTES,
    },
  });

const notFound = (ref: AssetRef, cause?: unknown) =>
  new EngineError('NOT_FOUND', {
    details: { unitId: ref.unitId, path: ref.path },
    ...(cause !== undefined ? { cause } : {}),
  });

/** Escape-проверка пути: `..` за корень, завершающий `/` (vfs `join_internal`). */
const escapesRoot = (path: string) => {
  try {
    return resolveAssetPath('', path).escapes;
  } catch {
    return true;
  }
};

export const readAsset = async (
  source: CourseSource,
  library: Library,
  ref: AssetRef,
): Promise<AssetContent> => {
  const manifest =
    library.getCourse(ref.unitId) ??
    library.getLesson(ref.unitId) ??
    library.getExercise(ref.unitId);
  if (manifest === undefined) throw notFound(ref);
  if (!assetPathsOf(manifest).includes(ref.path)) {
    throw outsideLibrary(ref, 'path is not an asset of the unit');
  }
  if (escapesRoot(ref.path)) throw outsideLibrary(ref, 'path leaves the root');

  const stat = await source.stat(ref.path);
  if (stat === null || stat.kind !== 'file') throw notFound(ref);
  if (stat.outsideRoot === true)
    throw outsideLibrary(ref, 'symlink leaves the root');
  if (stat.bytes > MAX_ASSET_BYTES) throw tooLarge(ref, stat.bytes);

  let bytes: Uint8Array;
  try {
    bytes = await source.readBytes(ref.path);
  } catch (error) {
    throw notFound(ref, error);
  }
  // файл мог вырасти между `stat` и чтением
  if (bytes.length > MAX_ASSET_BYTES) throw tooLarge(ref, bytes.length);
  return {
    ref,
    mime: 'text/markdown',
    text: stripFrontmatter(new TextDecoder().decode(bytes)),
    bytes: bytes.length,
  };
};
