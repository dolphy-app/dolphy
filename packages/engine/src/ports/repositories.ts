import type {
  EngineErrorDto,
  EpochMs,
  GitFetchFailureReason,
  UnitId,
} from '@dolphy-app/engine-contract';
import type { CourseSource } from './index.ts';

/**
 * Запись реестра git-репозиториев (`RepositoryStore`). `status` не хранится:
 * `updating` выводится из активных операций, `error` — из `lastError` и
 * отсутствия каталога снимка.
 */
export interface RepositoryRecord {
  id: string;
  /** Нормализованный URL. */
  url: string;
  ref: string | null;
  /** Полный SHA-1 загруженного коммита. */
  commit: string;
  fetchedAt: EpochMs;
  courseIds: UnitId[];
  lastError?: EngineErrorDto;
}

/**
 * Реестр репозиториев одного устройства (в синхронизацию не входит).
 * Адаптеры: SQLite (`engine.db`, продукт) и память (тесты).
 */
export interface RepositoryStore {
  /** Записи, отсортированные по `id`. */
  list(): Promise<readonly RepositoryRecord[]>;
  /** Вставка или замена записи с тем же `id`. */
  put(record: RepositoryRecord): Promise<void>;
  /** `false`, если записи не было. */
  delete(id: string): Promise<boolean>;
}

/** Лимиты снимка; превышение — `GitFetchError('too-large')` или `SnapshotRejectedError`. */
export interface SnapshotLimits {
  maxFiles: number;
  /** Суммарный размер файлов снимка. */
  maxBytes: number;
  maxFileBytes: number;
  /** Сеть без единого байта дольше — `GitFetchError('timeout')`. */
  idleTimeoutMs: number;
}

/** Запрошенный снимок уточнён до полного имени ссылки и SHA-1 коммита. */
export interface ResolvedRef {
  /** Полное имя: `refs/heads/main`, `refs/tags/v1`. */
  ref: string;
  commit: string;
}

export interface SnapshotProgress {
  loaded: number;
  total?: number;
}

export interface ResolveRequest {
  url: string;
  /** Короткое имя ветки или тега; `null` — ветка по умолчанию (`HEAD`). */
  ref: string | null;
  signal: AbortSignal;
}

export interface FetchSnapshotRequest extends ResolveRequest {
  /** Пустой каталог для дерева коммита (создаёт вызывающий). */
  destDir: string;
  /** Пустой каталог под временный `gitdir`; вызывающий удаляет его после вызова. */
  tmpDir: string;
  limits: SnapshotLimits;
  onProgress(phase: 'fetch' | 'export', progress: SnapshotProgress): void;
}

export interface FetchedSnapshot extends ResolvedRef {
  files: number;
  bytes: number;
}

/**
 * Получение снимка дерева git-коммита по `http(s)`. Снимок — только обычные
 * файлы и каталоги (без `.git`). Сбои сети — `GitFetchError`, нарушение
 * правил снимка — `SnapshotRejectedError`; отмена `signal` — `AbortError`.
 * Ничего не пишет вне `destDir` и `tmpDir`.
 */
export interface GitSnapshotFetcher {
  /** Коммит ветки или тега без скачивания объектов. */
  resolve(req: ResolveRequest): Promise<ResolvedRef>;
  /** Shallow-загрузка `ref` и запись его дерева в `destDir`. */
  fetchSnapshot(req: FetchSnapshotRequest): Promise<FetchedSnapshot>;
}

export class GitFetchError extends Error {
  readonly reason: GitFetchFailureReason;

  constructor(
    reason: GitFetchFailureReason,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'GitFetchError';
    this.reason = reason;
  }
}

/** Нарушение правил снимка (R7 спеки `course-git-source`). */
export type SnapshotViolation =
  | 'symlink'
  | 'path-escapes'
  | 'git-segment'
  | 'unsafe-name'
  | 'case-collision'
  | 'special-file'
  | 'too-many-files'
  | 'too-large'
  | 'file-too-large';

export class SnapshotRejectedError extends Error {
  readonly violation: SnapshotViolation;
  /** Путь в репозитории, на котором сработало правило. */
  readonly path?: string;

  constructor(violation: SnapshotViolation, message: string, path?: string) {
    super(message);
    this.name = 'SnapshotRejectedError';
    this.violation = violation;
    if (path !== undefined) this.path = path;
  }
}

export interface OperationDirs {
  /** Для `FetchSnapshotRequest.destDir`. */
  stagingDir: string;
  /** Для `FetchSnapshotRequest.tmpDir`. */
  tmpDir: string;
}

/**
 * Корень назначения в библиотеке: `repositories/<id>` — снимки git-репозиториев,
 * `imported/<имя>` — курсы, присланные импортёрами расширений. Сканер обходит
 * оба как обычные каталоги библиотеки.
 */
export type SnapshotRoot = 'repositories' | 'imported';

/**
 * Файловые операции над каталогами в `<libraryRoot>/repositories/<id>` и
 * `<libraryRoot>/imported/<id>`. Промежуточные каталоги (`.staging`,
 * `.trash` в корне библиотеки, `git-tmp` в `dataDir`) лежат на тех же файловых
 * системах, что их цели, а сканер пропускает каталоги с точкой. Операция
 * (`opId`) работает с одним корнем; `.staging/<opId>` общий для обоих.
 */
export interface SnapshotInstaller {
  /** Относительный путь каталога в библиотеке: `<root>/<id>`. */
  snapshotPath(root: SnapshotRoot, id: string): string;
  /**
   * Создаёт пустые каталоги операции; `stagingDir` — `.staging/<opId>/<id>`.
   * Каталог лежит в `<id>` внутри `.staging/<opId>`, чтобы сканер видел его
   * дочерним каталогом корня библиотеки, как после установки (корневой
   * `course_manifest.json` — курс).
   */
  begin(root: SnapshotRoot, id: string, opId: string): Promise<OperationDirs>;
  /**
   * Записывает файлы (`путь → текст UTF-8`) в `.staging/<opId>/<id>`, созданный
   * `begin`. Пути проверяются заново: относительные, с `/`, без `..`, пустых и
   * начинающихся с точки сегментов; иначе ошибка без записи остальных.
   */
  writeStaging(
    id: string,
    opId: string,
    files: Readonly<Record<string, string>>,
  ): Promise<void>;
  /**
   * Источник курсов над `.staging/<opId>` (для проверки до подмены): каталог
   * виден как `<id>`, пути диагностик начинаются с `<id>/`.
   */
  stagingSource(opId: string): CourseSource;
  /** Есть ли каталог `<root>/<id>`. */
  exists(root: SnapshotRoot, id: string): Promise<boolean>;
  /** `<root>/<id>` (если есть) → `.trash/<root>/<opId>`, `.staging/<opId>/<id>` → `<root>/<id>`. */
  install(root: SnapshotRoot, id: string, opId: string): Promise<void>;
  /** Обратно после `install`: новый каталог удаляется, старый из `.trash` возвращается. */
  rollback(root: SnapshotRoot, id: string, opId: string): Promise<void>;
  /** Удаляет каталоги операции (`.trash`, `.staging`, `git-tmp`). */
  finish(opId: string): Promise<void>;
  /** Удаляет каталог `<root>/<id>`. */
  remove(root: SnapshotRoot, id: string): Promise<void>;
  /**
   * Старт: достраивает прерванные подмены в обоих корнях, удаляет `.staging`,
   * `.trash`, `git-tmp`; возвращает `id` каталогов каждого корня, чтобы
   * вызывающий сверил их с реестром.
   */
  recover(): Promise<Record<SnapshotRoot, string[]>>;
}

/** Лимиты по умолчанию (спека `course-git-source`, Решения). */
export const DEFAULT_SNAPSHOT_LIMITS: SnapshotLimits = {
  maxFiles: 20_000,
  maxBytes: 256 * 1024 * 1024,
  maxFileBytes: 32 * 1024 * 1024,
  idleTimeoutMs: 60_000,
};
