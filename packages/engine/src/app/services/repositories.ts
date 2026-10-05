import type {
  AddRepositoryRequest,
  Diagnostic,
  LibraryInfo,
  LibraryService,
  RepositoriesService,
  RepositoryDto,
  RepositoryPhase,
  RepositoryStatus,
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
import {
  normalizeRepositoryRef,
  normalizeRepositoryUrl,
  repositorySlug,
  urlHash8,
} from '../repository-url.ts';

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

type OperationKind = 'add' | 'update' | 'remove';

/** Операция над репозиторием; `id` у `add` появляется, когда очередь дошла до неё. */
interface Operation {
  readonly kind: OperationKind;
  id: string | null;
  readonly controller: AbortController;
  /** Подмена снимка началась: отмена уже не принимается. */
  committing: boolean;
}

interface Target {
  id: string;
  url: string;
  ref: string | null;
  /** Запись до операции (`update`). */
  previous?: RepositoryRecord;
}

interface FlowResult {
  changed: boolean;
  record: RepositoryRecord;
}

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
  ...(record.lastError !== undefined && { lastError: record.lastError }),
});

const withoutLastError = (record: RepositoryRecord): RepositoryRecord => ({
  id: record.id,
  url: record.url,
  ref: record.ref,
  commit: record.commit,
  fetchedAt: record.fetchedAt,
  courseIds: record.courseIds,
});

const rejected = (
  message: string,
  details: Record<string, unknown>,
): EngineError => new EngineError('REPOSITORY_REJECTED', { message, details });

const notFound = (id: unknown): EngineError =>
  new EngineError('NOT_FOUND', { details: { id } });

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

  closeSignal?.addEventListener('abort', () => {
    for (const op of operations) abort(op);
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
    if (operationsOf(record.id).length > 0) return 'updating';
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
    fetched: { commit: string; courseIds: string[] },
  ): Promise<FlowResult> => {
    const { id, url, ref } = target;
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

  /** `resolve → fetch → export → validate → (queue) reload`; общий путь `add` и `update`. */
  const fetchFlow = async (
    op: Operation,
    target: Target,
  ): Promise<FlowResult> => {
    const { id, url, ref, previous } = target;
    const { signal } = op.controller;
    const opId = ctx.ids.next().toLowerCase();
    let began = false;
    try {
      signal.throwIfAborted();
      progress(id, 'resolve');
      const resolved = await fetcher.resolve({ url, ref, signal });
      const upToDate = async (commit: string) =>
        previous !== undefined &&
        commit === previous.commit &&
        (await installer.exists(ROOT, id));
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
      if (previous !== undefined && (await upToDate(snapshot.commit))) {
        return { changed: false, record: await settle(previous) };
      }
      progress(id, 'validate');
      const courseIds = await validateStaging(id, opId);
      signal.throwIfAborted();
      return await exclusive(() =>
        commit(op, target, opId, { commit: snapshot.commit, courseIds }),
      );
    } catch (error) {
      const failure = toFailure(error, op);
      if (
        previous !== undefined &&
        failure instanceof EngineError &&
        failure.code === 'REPOSITORY_REJECTED'
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
      const { record } = await fetchFlow(op, { id, url, ref });
      return toDto(record, 'ready');
    });
  };

  const update = async (id: string): Promise<UpdateRepositoryResult> => {
    const op = newOperation('update', id);
    return serial(op, async () => {
      const previous = await find(id);
      if (previous === undefined) throw notFound(id);
      const { changed, record } = await fetchFlow(op, {
        id,
        url: previous.url,
        ref: previous.ref,
        previous,
      });
      // сервер мог уйти вперёд за время операции: пометка появится после следующей проверки
      checks.delete(id);
      return {
        changed,
        repository: toDto(record, record.lastError ? 'error' : 'ready'),
      };
    });
  };

  const remove = async (id: string): Promise<void> => {
    // идущие операции над репозиторием прерываются сразу, не дожидаясь очереди
    for (const running of operationsOf(id)) abort(running);
    const op = newOperation('remove', id);
    return serial(op, async () => {
      if ((await find(id)) === undefined) throw notFound(id);
      await exclusive(async () => {
        if (ctx.state.closed) throw new EngineError('ENGINE_CLOSED');
        try {
          if (ctx.state.dirty) await ctx.rebuild();
          await installer.remove(ROOT, id);
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

  return { list, add, update, remove, cancel, checkUpdates };
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
