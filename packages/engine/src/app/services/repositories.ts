import type {
  AddRepositoryRequest,
  Diagnostic,
  LibraryInfo,
  LibraryService,
  PreviewRepositoryRequest,
  RemoveRepositoryOptions,
  RepositoriesService,
  RepositoryDto,
  RepositoryPhase,
  RepositoryPreviewDto,
  RepositoryStatus,
  UpdateRepositoryOptions,
  UpdateRepositoryResult,
} from '@dolphy-app/engine-contract';
import { loadCompiled } from '../../authoring/artifact.ts';
import { compile } from '../../authoring/compile.ts';
import {
  DEFAULT_SNAPSHOT_LIMITS,
  GitFetchError,
  SnapshotRejectedError,
} from '../../ports/index.ts';
import type {
  GitSnapshotFetcher,
  RepositoryRecord,
  RepositoryStore,
  SnapshotInstaller,
  SnapshotRoot,
} from '../../ports/index.ts';
import type { EngineContext } from '../context.ts';
import { EngineError } from '../errors.ts';
import { commitProgressResets } from '../progress-reset.ts';
import {
  normalizeCourseSelection,
  normalizeRepositoryRef,
  normalizeRepositoryUrl,
  repositorySlug,
  urlHash8,
} from '../repository-url.ts';
import { inspectSnapshot, scanCourses } from '../repository-courses.ts';

/** Снимки репозиториев лежат в `<libraryRoot>/repositories/<id>`. */
const ROOT: SnapshotRoot = 'repositories';

/** Сколько диагностик попадает в `details` отказа. */
const MAX_DIAGNOSTICS = 50;

export interface RepositoriesServiceDeps {
  library: Pick<LibraryService, 'reload' | 'getDiagnostics'>;
  /** Выполняет задачу в очереди команд движка (подмена снимка и `reload`). */
  exclusive<T>(task: () => Promise<T>): Promise<T>;
  /** Закрытие движка: прерывает идущие операции. */
  closeSignal?: AbortSignal;
}

type OperationKind = 'add' | 'update' | 'remove' | 'preview';

/** Операция над репозиторием; `id` у `add` появляется, когда очередь дошла до неё. */
interface Operation {
  readonly kind: OperationKind;
  id: string | null;
  readonly controller: AbortController;
  /** Подмена снимка началась: отмена уже не принимается. */
  committing: boolean;
}

/** Сколько снимок предпросмотра ждёт установки. */
export const PREVIEW_TTL_MS = 5 * 60 * 1000;

/** Сколько снимков предпросмотров хранится одновременно: каждый до `maxBytes` на диске. */
export const MAX_HELD_PREVIEWS = 2;

/** Скачанный снимок предпросмотра: каталог `.staging/<opId>/<id>` ждёт `add`/`update` с токеном `opId`. */
interface HeldPreview {
  opId: string;
  /** Каталог снимка называется `<id>`: годится только для установки под тем же `id`. */
  id: string;
  url: string;
  ref: string | null;
  commit: string;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}

interface Target {
  id: string;
  url: string;
  ref: string | null;
  /** Курсы, которые нужно поставить; `null` — все курсы коммита. */
  selected: string[] | null;
  /** Выбор задан этим вызовом: неизвестный курс — отказ, а не пропуск. */
  explicit: boolean;
  /** Запись до операции (`update`). */
  previous?: RepositoryRecord;
  /** `RepositoryPreviewDto.previewId`: установить из скачанного снимка. */
  previewId?: string;
}

interface FlowResult {
  changed: boolean;
  record: RepositoryRecord;
}

/** `removeProgress` из параметров `remove`: только булево значение; по умолчанию прогресс остаётся. */
const removeProgressOf = (options: unknown): boolean => {
  if (options === undefined) return false;
  const value =
    typeof options === 'object' && options !== null
      ? Reflect.get(options, 'removeProgress')
      : null;
  if (value === undefined) return false;
  if (typeof value !== 'boolean') {
    throw new EngineError('INVALID_ARGUMENT', {
      message: 'removeProgress must be a boolean',
      details: { field: 'removeProgress' },
    });
  }
  return value;
};

const isCancellable = (op: Operation): boolean => op.kind !== 'remove';

const toDto = (
  record: RepositoryRecord,
  status: RepositoryStatus,
): RepositoryDto => ({
  id: record.id,
  url: record.url,
  ref: record.ref,
  commit: record.commit,
  fetchedAt: record.fetchedAt,
  status,
  courseIds: [...record.courseIds],
  skippedCourseIds: [...(record.skippedCourseIds ?? [])],
  ...(record.lastError !== undefined && { lastError: record.lastError }),
});

const withoutLastError = (record: RepositoryRecord): RepositoryRecord => ({
  id: record.id,
  url: record.url,
  ref: record.ref,
  commit: record.commit,
  fetchedAt: record.fetchedAt,
  courseIds: record.courseIds,
  ...(record.selected !== undefined && { selected: record.selected }),
  ...(record.skippedCourseIds !== undefined && {
    skippedCourseIds: record.skippedCourseIds,
  }),
});

/** Выбор курсов как множество: порядок не важен; `null` — «все курсы». */
const sameSelection = (
  a: readonly string[] | null,
  b: readonly string[] | null,
): boolean => {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((courseId) => b.includes(courseId));
};

const rejected = (
  message: string,
  details: Record<string, unknown>,
): EngineError => new EngineError('REPOSITORY_REJECTED', { message, details });

const notFound = (id: unknown): EngineError =>
  new EngineError('NOT_FOUND', { details: { id } });

/**
 * Отказ по запросу, а не по репозиторию: курсы выбраны неверно. Состояние
 * репозитория цело, поэтому `lastError` в записи не пишется.
 */
const isSelectionRefusal = (failure: EngineError): boolean => {
  const reason = failure.details?.['reason'];
  return reason === 'unknown-course' || reason === 'missing-requirement';
};

/**
 * `repositories.*` (спека `course-git-source`): реестр git-репозиториев и
 * снимки их деревьев в `<libraryRoot>/repositories/<id>`.
 *
 * Операции над репозиториями идут строго по одной (цепочка `serial`, R10),
 * но вне очереди команд движка: сеть и запись в `.staging` не мешают `plan`
 * и `practice` (R8). В очередь (`exclusive`) операция встаёт только на
 * подмену снимка, `library.reload` и запись реестра.
 */
export const createRepositoriesService = (
  ctx: EngineContext,
  { library, exclusive, closeSignal }: RepositoriesServiceDeps,
): RepositoriesService => {
  const store: RepositoryStore = ctx.repositoryStore;
  const fetcher: GitSnapshotFetcher = ctx.snapshotFetcher;
  const installer: SnapshotInstaller = ctx.snapshotInstaller;
  const operations = new Set<Operation>();
  /** Последняя успешная сверка с сервером в этом запуске: в `engine.db` не пишется. */
  const checks = new Map<string, { remoteCommit: string; checkedAt: number }>();
  let chain: Promise<unknown> = Promise.resolve();

  const operationsOf = (id: string): Operation[] =>
    [...operations].filter((op) => op.id === id);

  const abort = (op: Operation): void => {
    if (isCancellable(op) && !op.committing) op.controller.abort();
  };

  /** Снимки предпросмотров, ожидающие установки (ключ — `opId` = `previewId`). */
  const held = new Map<string, HeldPreview>();

  const releaseHeld = (entry: HeldPreview): void => {
    clearTimeout(entry.timer);
    void installer.finish(entry.opId).catch((error: unknown) => {
      ctx.logger.warn(
        { error, opId: entry.opId },
        'cannot clean up preview dirs',
      );
    });
  };

  const dropHeld = (opId: string): void => {
    const entry = held.get(opId);
    if (entry === undefined) return;
    held.delete(opId);
    releaseHeld(entry);
  };

  /** Новый снимок заменяет прежний того же адреса и ветки; сверх `MAX_HELD_PREVIEWS` вытесняется самый старый. */
  const holdPreview = (entry: Omit<HeldPreview, 'expiresAt' | 'timer'>) => {
    for (const other of [...held.values()]) {
      if (other.url === entry.url && other.ref === entry.ref) {
        dropHeld(other.opId);
      }
    }
    while (held.size >= MAX_HELD_PREVIEWS) {
      const oldest = held.keys().next().value;
      if (oldest === undefined) break;
      dropHeld(oldest);
    }
    const timer = setTimeout(() => dropHeld(entry.opId), PREVIEW_TTL_MS);
    timer.unref();
    held.set(entry.opId, {
      ...entry,
      expiresAt: ctx.clock.now() + PREVIEW_TTL_MS,
      timer,
    });
  };

  /**
   * Достаёт снимок предпросмотра для `add`/`update`: только живой токен того
   * же адреса, ветки и репозитория. Просроченный снимок удаляется; чужой
   * токен не трогается; незнакомый — не ошибка (вызывающий качает заново).
   */
  const takePreview = (
    previewId: string | undefined,
    url: string,
    ref: string | null,
    id: string,
  ): HeldPreview | null => {
    if (previewId === undefined) return null;
    const entry = held.get(previewId);
    if (entry === undefined) return null;
    if (ctx.clock.now() >= entry.expiresAt) {
      dropHeld(previewId);
      return null;
    }
    if (entry.url !== url || entry.ref !== ref || entry.id !== id) return null;
    held.delete(previewId);
    clearTimeout(entry.timer);
    return entry;
  };

  closeSignal?.addEventListener('abort', () => {
    for (const op of operations) abort(op);
    for (const opId of [...held.keys()]) dropHeld(opId);
  });

  const serial = <T>(op: Operation, body: () => Promise<T>): Promise<T> => {
    operations.add(op);
    const result = chain.then(body).finally(() => void operations.delete(op));
    chain = result.catch(() => undefined);
    return result;
  };

  const newOperation = (kind: OperationKind, id: string | null): Operation => ({
    kind,
    id,
    controller: new AbortController(),
    committing: false,
  });

  const progress = (
    id: string,
    phase: RepositoryPhase,
    loaded?: number,
    total?: number,
  ): void => {
    ctx.bus.publish({
      type: 'repository-progress',
      id,
      phase,
      ...(loaded !== undefined && { loaded }),
      ...(total !== undefined && { total }),
    });
  };

  const find = async (id: string): Promise<RepositoryRecord | undefined> =>
    (await store.list()).find((record) => record.id === id);

  /** Результат проверки, если он ещё про загруженный коммит: совпавший с серверным коммит ничего не предлагает. */
  const withCheck = (dto: RepositoryDto): RepositoryDto => {
    const check = checks.get(dto.id);
    if (check === undefined) return dto;
    return {
      ...dto,
      checkedAt: check.checkedAt,
      ...(check.remoteCommit !== dto.commit && {
        availableCommit: check.remoteCommit,
      }),
    };
  };

  const statusOf = async (
    record: RepositoryRecord,
  ): Promise<RepositoryStatus> => {
    // предпросмотр репозитория ничего не обновляет
    const running = operationsOf(record.id).filter(
      ({ kind }) => kind !== 'preview',
    );
    if (running.length > 0) return 'updating';
    if (record.lastError !== undefined) return 'error';
    return (await installer.exists(ROOT, record.id)) ? 'ready' : 'error';
  };

  const uniqueId = async (
    url: string,
    records: readonly RepositoryRecord[],
  ): Promise<string> => {
    const base = repositorySlug(url);
    const taken = new Set(records.map((record) => record.id));
    if (!taken.has(base)) return base;
    const suffixed = `${base}-${await urlHash8(url)}`;
    if (taken.has(suffixed)) {
      throw new EngineError('REPOSITORY_EXISTS', { details: { id: suffixed } });
    }
    return suffixed;
  };

  /**
   * Сканирование staging: снимок `<id>` — дочерний каталог корня, как потом в
   * `repositories/<id>`; курсы есть, ошибок нет. Пути диагностик — от корня
   * репозитория (префикс `<id>/` снимается).
   */
  const validateStaging = async (
    id: string,
    opId: string,
  ): Promise<string[]> => {
    const result = await compile(installer.stagingSource(opId), {
      scan: { ignoredPaths: [] },
    });
    const prefix = `${id}/`;
    const relative = (diagnostic: Diagnostic): Diagnostic =>
      diagnostic.path?.startsWith(prefix)
        ? { ...diagnostic, path: diagnostic.path.slice(prefix.length) }
        : diagnostic;
    const errors = result.diagnostics
      .filter(({ severity }) => severity === 'error')
      .map(relative);
    if (result.artifact === null || errors.length > 0) {
      throw rejected('Repository contains an invalid course library', {
        reason: 'invalid-library',
        summary: result.summary,
        diagnostics: errors.slice(0, MAX_DIAGNOSTICS),
      });
    }
    const courseIds = loadCompiled(result.artifact).getCourseIds();
    if (courseIds.length === 0) {
      throw rejected('Repository contains no courses', {
        reason: 'no-courses',
        summary: result.summary,
        diagnostics: [],
      });
    }
    return courseIds;
  };

  const reloadRejection = async (info: LibraryInfo): Promise<EngineError> => {
    // до отката: следующий `reload` сбросит диагностики отклонённой версии
    const page = await library.getDiagnostics({
      minSeverity: 'error',
      limit: MAX_DIAGNOSTICS,
    });
    return rejected('Library reload rejected the repository snapshot', {
      reason: 'reload-rejected',
      summary: info.diagnostics,
      diagnostics: page.items,
    });
  };

  /** Возвращает прежний снимок и прежнюю библиотеку; сбой отката только логируется. */
  const restore = async (id: string, opId: string): Promise<void> => {
    try {
      await installer.rollback(ROOT, id, opId);
      await library.reload();
    } catch (error) {
      ctx.logger.error({ error, id }, 'repository rollback failed');
    }
  };

  /**
   * Подмена снимка в очереди команд: `install` → `reload` → (при отказе
   * откат) → запись реестра → события. Реестр пишется последним.
   */
  const commit = async (
    op: Operation,
    target: Target,
    opId: string,
    fetched: {
      commit: string;
      courseIds: string[];
      skippedCourseIds: string[];
    },
  ): Promise<FlowResult> => {
    const { id, url, ref, selected } = target;
    if (ctx.state.closed) throw new EngineError('ENGINE_CLOSED');
    op.controller.signal.throwIfAborted();
    op.committing = true;
    try {
      if (ctx.state.dirty) await ctx.rebuild();
      progress(id, 'reload');
      const record: RepositoryRecord = {
        id,
        url,
        ref,
        commit: fetched.commit,
        fetchedAt: ctx.clock.now(),
        courseIds: fetched.courseIds,
        ...(selected !== null && { selected }),
        ...(fetched.skippedCourseIds.length > 0 && {
          skippedCourseIds: fetched.skippedCourseIds,
        }),
      };
      let installed = false;
      try {
        await installer.install(ROOT, id, opId);
        installed = true;
        const info = await library.reload();
        if (info.state === 'invalid' || info.diagnostics.errors > 0) {
          throw await reloadRejection(info);
        }
        await store.put(record);
      } catch (error) {
        if (installed) await restore(id, opId);
        throw error;
      }
      ctx.bus.flush();
      return { changed: true, record };
    } catch (error) {
      ctx.bus.discard();
      throw error;
    }
  };

  /** Сбой операции → ошибка движка; неизвестные ошибки (баги, сбои ФС) идут как есть. */
  const toFailure = (error: unknown, op: Operation): unknown => {
    if (error instanceof EngineError) return error;
    if (op.controller.signal.aborted && !op.committing) {
      if (ctx.state.closed) return new EngineError('ENGINE_CLOSED');
      return new EngineError('GIT_FETCH_FAILED', {
        message: 'Repository operation was cancelled',
        details: { reason: 'cancelled' },
      });
    }
    if (error instanceof SnapshotRejectedError) {
      return rejected(error.message, {
        reason: error.violation,
        ...(error.path !== undefined && { path: error.path }),
      });
    }
    if (error instanceof GitFetchError) {
      return new EngineError('GIT_FETCH_FAILED', {
        message: error.message,
        details: { reason: error.reason },
        cause: error,
      });
    }
    return error;
  };

  const recordRejection = async (
    previous: RepositoryRecord,
    failure: EngineError,
  ): Promise<void> => {
    try {
      await store.put({ ...previous, lastError: failure.toDto() });
    } catch (error) {
      ctx.logger.error({ error, id: previous.id }, 'cannot store lastError');
    }
  };

  /** Снимок цел и совпал с сервером: прежняя ошибка отклонённого коммита больше не актуальна. */
  const settle = async (
    record: RepositoryRecord,
  ): Promise<RepositoryRecord> => {
    if (record.lastError === undefined) return record;
    const cleared = withoutLastError(record);
    await store.put(cleared);
    return cleared;
  };

  /**
   * Явный выбор курсов (`target.selected`): курсы снимка → проверка выбора →
   * удаление каталогов невыбранных. Возвращает курсы коммита без выбора.
   * Запомненный выбор (`explicit: false`) не отвергается за курсы, которых
   * в коммите больше нет: они просто не ставятся.
   */
  const applySelection = async (
    id: string,
    opId: string,
    selected: readonly string[],
    explicit: boolean,
  ): Promise<string[]> => {
    const { courses, dirs } = await scanCourses(
      installer.stagingSource(opId),
      id,
    );
    const known = new Set(courses.map((course) => course.id));
    if (explicit) {
      const unknown = selected.filter((courseId) => !known.has(courseId));
      if (unknown.length > 0) {
        throw rejected('Selected courses are not in the repository', {
          reason: 'unknown-course',
          courseIds: unknown,
        });
      }
    }
    const wanted = new Set(selected.filter((courseId) => known.has(courseId)));
    if (wanted.size === 0) {
      throw rejected('Repository contains none of the selected courses', {
        reason: 'no-courses',
        summary: { errors: 0, warnings: 0, infos: 0 },
        diagnostics: [],
      });
    }
    const requirements: Record<string, string[]> = {};
    for (const course of courses) {
      if (!wanted.has(course.id)) continue;
      const missing = course.requires.filter((need) => !wanted.has(need));
      if (missing.length > 0) requirements[course.id] = missing;
    }
    if (Object.keys(requirements).length > 0) {
      throw rejected('Selected courses need courses that are not selected', {
        reason: 'missing-requirement',
        requirements,
      });
    }
    const skipped = courses.filter((course) => !wanted.has(course.id));
    const paths = skipped
      .map((course) => dirs.get(course.id))
      .filter((path): path is string => path !== undefined && path !== '');
    await installer.prune(id, opId, paths);
    return skipped.map((course) => course.id);
  };

  /** `(preview) | resolve → fetch → export → (select) → validate → (queue) reload`; общий путь `add` и `update`. */
  const fetchFlow = async (
    op: Operation,
    target: Target,
  ): Promise<FlowResult> => {
    const { id, url, ref, previous, selected, explicit } = target;
    const { signal } = op.controller;
    // снимок предпросмотра заменяет загрузку; расходуется при любом исходе
    const staged = takePreview(target.previewId, url, ref, id);
    const opId = staged?.opId ?? ctx.ids.next().toLowerCase();
    let began = staged !== null;
    try {
      signal.throwIfAborted();
      // тот же коммит и тот же выбор: скачивать нечего
      const upToDate = async (commit: string) =>
        previous !== undefined &&
        commit === previous.commit &&
        sameSelection(selected, previous.selected ?? null) &&
        (await installer.exists(ROOT, id));
      let loadedCommit: string;
      if (staged !== null) {
        loadedCommit = staged.commit;
        if (previous !== undefined && (await upToDate(loadedCommit))) {
          return { changed: false, record: await settle(previous) };
        }
      } else {
        progress(id, 'resolve');
        const resolved = await fetcher.resolve({ url, ref, signal });
        if (previous !== undefined && (await upToDate(resolved.commit))) {
          return { changed: false, record: await settle(previous) };
        }
        began = true;
        const dirs = await installer.begin(ROOT, id, opId);
        signal.throwIfAborted();
        progress(id, 'fetch');
        const snapshot = await fetcher.fetchSnapshot({
          url,
          ref,
          signal,
          destDir: dirs.stagingDir,
          tmpDir: dirs.tmpDir,
          limits: DEFAULT_SNAPSHOT_LIMITS,
          onProgress: (phase, { loaded, total }) =>
            progress(id, phase, loaded, total),
        });
        signal.throwIfAborted();
        loadedCommit = snapshot.commit;
        if (previous !== undefined && (await upToDate(loadedCommit))) {
          return { changed: false, record: await settle(previous) };
        }
      }
      progress(id, 'validate');
      const skippedCourseIds =
        selected === null
          ? []
          : await applySelection(id, opId, selected, explicit);
      const courseIds = await validateStaging(id, opId);
      signal.throwIfAborted();
      return await exclusive(() =>
        commit(op, target, opId, {
          commit: loadedCommit,
          courseIds,
          skippedCourseIds,
        }),
      );
    } catch (error) {
      const failure = toFailure(error, op);
      if (
        previous !== undefined &&
        failure instanceof EngineError &&
        failure.code === 'REPOSITORY_REJECTED' &&
        !isSelectionRefusal(failure)
      ) {
        await recordRejection(previous, failure);
      }
      throw failure;
    } finally {
      if (began) {
        await installer.finish(opId).catch((error: unknown) => {
          ctx.logger.warn({ error, opId }, 'cannot clean up repository dirs');
        });
      }
    }
  };

  const add = async (req: AddRepositoryRequest): Promise<RepositoryDto> => {
    const url = normalizeRepositoryUrl(req.url);
    const ref = normalizeRepositoryRef(req.ref);
    const selected = normalizeCourseSelection(req.courseIds);
    const op = newOperation('add', null);
    return serial(op, async () => {
      const records = await store.list();
      const existing = records.find((record) => record.url === url);
      if (existing !== undefined) {
        throw new EngineError('REPOSITORY_EXISTS', {
          details: { id: existing.id },
        });
      }
      const id = await uniqueId(url, records);
      op.id = id;
      if (await installer.exists(ROOT, id)) {
        throw rejected('Library already has a directory for this repository', {
          reason: 'path-conflict',
          path: installer.snapshotPath(ROOT, id),
        });
      }
      checks.delete(id);
      const { record } = await fetchFlow(op, {
        id,
        url,
        ref,
        selected,
        explicit: selected !== null,
        ...(req.previewId !== undefined && { previewId: req.previewId }),
      });
      return toDto(record, 'ready');
    });
  };

  const update = async (
    id: string,
    options?: UpdateRepositoryOptions,
  ): Promise<UpdateRepositoryResult> => {
    const chosen = normalizeCourseSelection(options?.courseIds);
    const op = newOperation('update', id);
    return serial(op, async () => {
      const previous = await find(id);
      if (previous === undefined) throw notFound(id);
      const { changed, record } = await fetchFlow(op, {
        id,
        url: previous.url,
        ref: previous.ref,
        previous,
        // без явного выбора действует прежний (запись без выбора — все курсы)
        selected: chosen ?? previous.selected ?? null,
        explicit: chosen !== null,
        ...(options?.previewId !== undefined && {
          previewId: options.previewId,
        }),
      });
      // сервер мог уйти вперёд за время операции: пометка появится после следующей проверки
      checks.delete(id);
      return {
        changed,
        repository: toDto(record, record.lastError ? 'error' : 'ready'),
      };
    });
  };

  /**
   * Скачивает коммит во временный каталог, сканирует и отдаёт курсы для
   * выбора. Ничего не устанавливает; снимок остаётся в `.staging/<opId>` до
   * установки по токену (`previewId` = `opId`), срока или вытеснения.
   */
  const preview = async (
    req: PreviewRepositoryRequest,
  ): Promise<RepositoryPreviewDto> => {
    const url = normalizeRepositoryUrl(req.url);
    const ref = normalizeRepositoryRef(req.ref);
    const op = newOperation('preview', null);
    return serial(op, async () => {
      const existing = (await store.list()).find(
        (record) => record.url === url,
      );
      const id = existing?.id ?? repositorySlug(url);
      op.id = id;
      const { signal } = op.controller;
      const opId = ctx.ids.next().toLowerCase();
      let began = false;
      let kept = false;
      try {
        signal.throwIfAborted();
        progress(id, 'resolve');
        began = true;
        const dirs = await installer.begin(ROOT, id, opId);
        progress(id, 'fetch');
        const snapshot = await fetcher.fetchSnapshot({
          url,
          ref,
          signal,
          destDir: dirs.stagingDir,
          tmpDir: dirs.tmpDir,
          limits: DEFAULT_SNAPSHOT_LIMITS,
          onProgress: (phase, { loaded, total }) =>
            progress(id, phase, loaded, total),
        });
        signal.throwIfAborted();
        progress(id, 'validate');
        const found = await inspectSnapshot(installer.stagingSource(opId), id);
        signal.throwIfAborted();
        const mine = new Set(existing?.courseIds ?? []);
        const loaded = new Set(
          ctx.library.current()?.library?.getCourseIds() ?? [],
        );
        // временный gitdir больше не нужен, снимок ждёт установки
        await installer.dropTmp(opId);
        holdPreview({ opId, id, url, ref, commit: snapshot.commit });
        kept = true;
        return {
          url,
          ref,
          commit: snapshot.commit,
          courses: found.map((course) => ({
            ...course,
            installed: mine.has(course.id),
            inLibrary: !mine.has(course.id) && loaded.has(course.id),
          })),
          previewId: opId,
        };
      } catch (error) {
        throw toFailure(error, op);
      } finally {
        if (began && !kept) {
          await installer.finish(opId).catch((error: unknown) => {
            ctx.logger.warn({ error, opId }, 'cannot clean up preview dirs');
          });
        }
      }
    });
  };

  const remove = async (
    id: string,
    options?: RemoveRepositoryOptions,
  ): Promise<void> => {
    const removeProgress = removeProgressOf(options);
    // идущие операции над репозиторием прерываются сразу, не дожидаясь очереди
    for (const running of operationsOf(id)) abort(running);
    const op = newOperation('remove', id);
    return serial(op, async () => {
      const record = await find(id);
      if (record === undefined) throw notFound(id);
      await exclusive(async () => {
        if (ctx.state.closed) throw new EngineError('ENGINE_CLOSED');
        try {
          if (ctx.state.dirty) await ctx.rebuild();
          await installer.remove(ROOT, id);
          // сброс идёт до `reload`: границы сброса считаются по графу, в котором курсы ещё есть;
          // после `installer.remove`: при сбое диска прогресс живого курса не теряется
          if (removeProgress) {
            await commitProgressResets(
              ctx,
              record.courseIds.map((unitId) => ({ unitId })),
            );
          }
          await store.delete(id);
          checks.delete(id);
          await library.reload();
          ctx.bus.flush();
        } catch (error) {
          ctx.bus.discard();
          throw error;
        }
      });
    });
  };

  const cancel = async (id: string): Promise<boolean> => {
    const running = operationsOf(id).filter(
      (op) => isCancellable(op) && !op.committing,
    );
    for (const op of running) op.controller.abort();
    return running.length > 0;
  };

  const list = async (): Promise<RepositoryDto[]> => {
    const records = await store.list();
    return Promise.all(
      records.map(async (record) =>
        withCheck(toDto(record, await statusOf(record))),
      ),
    );
  };

  const checkUpdates = async (): Promise<RepositoryDto[]> => {
    const signal = closeSignal ?? new AbortController().signal;
    let checked = 0;
    for (const record of await store.list()) {
      if (ctx.state.closed || signal.aborted) break;
      if (operationsOf(record.id).length > 0) continue;
      try {
        const { commit } = await fetcher.resolve({
          url: record.url,
          ref: record.ref,
          signal,
        });
        // за время ответа репозиторий могли обновить или удалить: результат устарел
        const current = await find(record.id);
        if (
          current?.commit !== record.commit ||
          operationsOf(record.id).length > 0
        ) {
          continue;
        }
        checks.set(record.id, {
          remoteCommit: commit,
          checkedAt: ctx.clock.now(),
        });
        checked++;
      } catch (error) {
        ctx.logger.warn(
          { error, id: record.id },
          'repository update check failed',
        );
      }
    }
    const items = await list();
    if (checked > 0) {
      ctx.bus.publish({
        type: 'repository-updates-checked',
        available: items
          .filter(({ availableCommit }) => availableCommit !== undefined)
          .map(({ id }) => id),
      });
    }
    return items;
  };

  return { list, preview, add, update, remove, cancel, checkUpdates };
};

/**
 * Фоновая проверка обновлений курсов при запуске (спека `course-updates`):
 * вызывающий не ждёт результат; сбой только в журнал.
 */
export const runStartupRepositoryCheck = async (
  ctx: Pick<EngineContext, 'logger'>,
  repositories: Pick<RepositoriesService, 'checkUpdates'>,
): Promise<void> => {
  try {
    await repositories.checkUpdates();
  } catch (error) {
    ctx.logger.warn({ error }, 'repository update check failed');
  }
};

/**
 * Старт движка (R9): достраивает прерванную подмену, удаляет промежуточные
 * каталоги и снимки без записи в реестре. Сеть не используется. Вызывается
 * до первой загрузки библиотеки, чтобы сканер видел чистое дерево.
 */
export const recoverRepositories = async (
  deps: Pick<EngineContext, 'repositoryStore' | 'snapshotInstaller' | 'logger'>,
): Promise<void> => {
  const { repositoryStore, snapshotInstaller, logger } = deps;
  try {
    // `imported/` реестра не имеет: каталоги импорта — обычные курсы библиотеки
    const { repositories: dirs } = await snapshotInstaller.recover();
    const known = new Set(
      (await repositoryStore.list()).map((record) => record.id),
    );
    for (const id of dirs) {
      if (known.has(id)) continue;
      try {
        await snapshotInstaller.remove(ROOT, id);
        logger.warn({ id }, 'removed repository snapshot without a record');
      } catch (error) {
        logger.warn({ error, id }, 'cannot remove repository snapshot');
      }
    }
  } catch (error) {
    // повреждённый реестр или ФС не должны мешать открыть библиотеку
    logger.error({ error }, 'repository recovery failed');
  }
};
