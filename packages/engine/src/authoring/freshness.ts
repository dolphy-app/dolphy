/**
 * Свежесть артефакта: быстрый путь — равенство `stat`-отпечатка, источник
 * истины — content-`revision`. Сравнение «mtime новее артефакта» не
 * используется: оно пропускает правки с восстановленным mtime (report-compiler.md §6.3).
 */
import type { ArtifactState } from '@spirula/engine-contract';
import type { CourseSource } from '../ports/index.ts';
import { decodeArtifact, FORMAT_VERSION } from './artifact.ts';
import type { Artifact } from './artifact.ts';
import {
  contentRevision,
  listInputs,
  readInputBytes,
  statFingerprint,
} from './revision.ts';

export interface FreshnessOptions {
  /** Те же пути, что при компиляции (`CompileOptions.excludeFromRevision`). */
  excludeFromRevision?: readonly string[];
}

export interface FreshnessResult {
  fresh: boolean;
  /**
   * `stat` — отпечаток совпал; `revision` — решил content-хеш (при `fresh`
   * артефакт вернётся с обновлённым `stat`); `none` — артефакт непригоден.
   */
  via: 'stat' | 'revision' | 'none';
  /** Только при `fresh` и `via: 'revision'`: голый `touch`, chmod, `git checkout`. */
  artifact?: Artifact;
}

export const checkFreshness = async (
  source: CourseSource,
  artifact: Artifact,
  { excludeFromRevision = [] }: FreshnessOptions = {},
): Promise<FreshnessResult> => {
  if (
    artifact.formatVersion !== FORMAT_VERSION ||
    artifact.diagnostics.summary.errors > 0
  ) {
    return { fresh: false, via: 'none' };
  }
  // отпечаток снимается до чтения: правка между ними даст расхождение при следующей проверке
  const files = await listInputs(source, excludeFromRevision);
  const stat = await statFingerprint(files);
  if (stat === artifact.stat) return { fresh: true, via: 'stat' };
  let revision: string;
  try {
    revision = await contentRevision(await readInputBytes(source, files));
  } catch {
    // файл исчез между листингом и чтением: библиотека изменилась
    return { fresh: false, via: 'revision' };
  }
  if (revision !== artifact.revision) return { fresh: false, via: 'revision' };
  return { fresh: true, via: 'revision', artifact: { ...artifact, stat } };
};

export interface ArtifactProbe {
  state: Exclude<ArtifactState, 'compiling'>;
  /** Только при `fresh`. */
  artifact: Artifact | null;
  /** Артефакт возвращён с обновлённым `stat`: стоит записать обратно. */
  refreshed: boolean;
}

/**
 * Читает артефакт порта и проверяет свежесть. Нет файла — `missing`; другой
 * `formatVersion`, повреждённый или собранный с ошибками — `stale`
 * (тихая перекомпиляция).
 */
export const probeArtifact = async (
  source: CourseSource,
  options: FreshnessOptions = {},
): Promise<ArtifactProbe> => {
  let text: string | null;
  try {
    text = await source.readArtifact();
  } catch {
    text = null;
  }
  if (text === null)
    return { state: 'missing', artifact: null, refreshed: false };
  let artifact: Artifact;
  try {
    artifact = decodeArtifact(text);
  } catch {
    return { state: 'stale', artifact: null, refreshed: false };
  }
  const result = await checkFreshness(source, artifact, options);
  if (!result.fresh)
    return { state: 'stale', artifact: null, refreshed: false };
  return {
    state: 'fresh',
    artifact: result.artifact ?? artifact,
    refreshed: result.artifact !== undefined,
  };
};
