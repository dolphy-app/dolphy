/**
 * Держатель загруженной библиотеки и её открытие: свежий артефакт →
 * `loadCompiled`, иначе `compile` с записью артефакта. Подмена атомарна:
 * ссылка меняется целиком, чтения во время перезагрузки видят прежнюю
 * библиотеку (engine-ts.md §9).
 */
import type {
  ArtifactState,
  Diagnostic,
  DiagnosticSummary,
} from '@dolphy-app/engine-contract';
import { EngineError } from '../app/errors.ts';
import type { Library } from '../domain/library.ts';
import type { Clock, CourseSource } from '../ports/index.ts';
import { encodeArtifact, loadCompiled } from './artifact.ts';
import type { Artifact } from './artifact.ts';
import { compile } from './compile.ts';
import type { CompileOptions } from './compile.ts';
import { probeArtifact } from './freshness.ts';

export interface LibraryStatus {
  state: 'ready' | 'invalid';
  /** `null` при `invalid`. */
  library: Library | null;
  /** Без `info`: их число — в `summary`. */
  diagnostics: readonly Diagnostic[];
  summary: DiagnosticSummary;
  /** content-`revision` загруженной библиотеки; `''`, если её нет (`invalid`). */
  revision: string;
  artifact: ArtifactState;
  loadedAt: number;
  loadMs: number;
}

export interface LibraryHolder {
  /** `null` — библиотеку ещё не открывали. */
  current(): LibraryStatus | null;
  /** `LIBRARY_NOT_LOADED` или `LIBRARY_INVALID`. */
  require(): Library;
  swap(next: LibraryStatus): void;
}

export const createLibraryHolder = (): LibraryHolder => {
  let status: LibraryStatus | null = null;
  return {
    current: () => status,
    require: () => {
      if (status === null) throw new EngineError('LIBRARY_NOT_LOADED');
      if (status.library === null) {
        throw new EngineError('LIBRARY_INVALID', {
          details: { errors: status.summary.errors },
        });
      }
      return status.library;
    },
    swap: (next) => {
      status = next;
    },
  };
};

export interface OpenLibraryDeps {
  clock: Clock;
}

export interface OpenLibraryOptions {
  compile?: CompileOptions;
}

const withoutInfo = (diagnostics: readonly Diagnostic[]) =>
  diagnostics.filter(({ severity }) => severity !== 'info');

/** Запись не удалась (библиотека только для чтения): открываем без кэша. */
const tryWriteArtifact = async (
  source: CourseSource,
  artifact: Artifact,
): Promise<boolean> => {
  try {
    await source.writeArtifact(encodeArtifact(artifact));
    return true;
  } catch {
    return false;
  }
};

export const openLibrary = async (
  source: CourseSource,
  { clock }: OpenLibraryDeps,
  options: OpenLibraryOptions = {},
): Promise<LibraryStatus> => {
  const started = clock.now();
  const probe = await probeArtifact(source, options.compile);
  if (probe.artifact !== null) {
    const { artifact } = probe;
    // после голого `touch` сохраняем обновлённый stat, чтобы не хешировать снова
    if (probe.refreshed) await tryWriteArtifact(source, artifact);
    const library = loadCompiled(artifact);
    const loadedAt = clock.now();
    return {
      state: 'ready',
      library,
      diagnostics: artifact.diagnostics.items,
      summary: artifact.diagnostics.summary,
      revision: artifact.revision,
      artifact: 'fresh',
      loadedAt,
      loadMs: loadedAt - started,
    };
  }
  const result = await compile(source, options.compile);
  const { artifact } = result;
  let artifactState: ArtifactState = probe.state;
  let library: Library | null = null;
  if (artifact !== null) {
    library = loadCompiled(artifact);
    if (await tryWriteArtifact(source, artifact)) artifactState = 'fresh';
  }
  const loadedAt = clock.now();
  return {
    state: library === null ? 'invalid' : 'ready',
    library,
    diagnostics: withoutInfo(result.diagnostics),
    summary: result.summary,
    revision: artifact?.revision ?? '',
    artifact: artifactState,
    loadedAt,
    loadMs: loadedAt - started,
  };
};

export interface ReloadResult {
  /** Холдер получил новую библиотеку (или первое состояние). */
  swapped: boolean;
  /** Результат открытия; при `swapped: false` — диагностики отклонённой версии. */
  status: LibraryStatus;
}

/**
 * Перезагрузка: новая версия с ошибками прежнюю библиотеку не заменяет
 * (наружу — диагностики). Пока прежней рабочей библиотеки нет, состояние
 * `invalid` записывается, чтобы `require()` отдавал актуальные ошибки.
 */
export const reloadLibrary = async (
  holder: LibraryHolder,
  source: CourseSource,
  deps: OpenLibraryDeps,
  options: OpenLibraryOptions = {},
): Promise<ReloadResult> => {
  const status = await openLibrary(source, deps, options);
  const previous = holder.current();
  if (status.state === 'invalid' && previous?.state === 'ready') {
    return { swapped: false, status };
  }
  holder.swap(status);
  return { swapped: true, status };
};
