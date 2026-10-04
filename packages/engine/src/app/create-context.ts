import { platformFromNode } from '@dolphy-app/keybindings';
import type {
  EngineConfig,
  EngineEvent,
  ExtensionSettingChangeDto,
  LearningEvent,
  SavedFilterDto,
  UnitId,
} from '@dolphy-app/engine-contract';
import {
  createLibraryHolder,
  openLibrary,
} from '../authoring/library-holder.ts';
import type { LibraryStatus } from '../authoring/library-holder.ts';
import type { LogEntry } from '../domain/journal.ts';
import type { Library } from '../domain/library.ts';
import type { Logger, StoreTx } from '../ports/index.ts';
import { createDepthFirstScheduler } from '../scheduler/depth-first-scheduler.ts';
import { getDue } from '../scheduler/due.ts';
import { getFrontier } from '../scheduler/frontier.ts';
import {
  InvalidSchedulerOptionsError,
  createSchedulerOptions,
  createSchedulerOptionsHolder,
} from '../scheduler/options.ts';
import { createSessionState } from '../scheduler/session-state.ts';
import { createMemoryIndex } from '../planning/memory-index.ts';
import { createFsrsScorer } from '../scoring/fsrs-scorer.ts';
import { createUnitScorer } from '../scoring/unit-scorer.ts';
import { createReplica } from '../sync/replica.ts';
import { appendInTx } from '../sync/merge.ts';
import { createCurrentScoringGraph } from '../state/current-graph.ts';
import { createProjections } from '../state/projections.ts';
import type {
  CommitInput,
  EngineContext,
  EngineDeps,
  EngineMetrics,
  ExtensionSettingChanges,
  OpenAttempt,
} from './context.ts';
import { createEventBus } from './event-bus.ts';
import { createExtensionApply } from './extension-apply.ts';
import { checkLibraryRoot, invalidStatus } from './library-root.ts';
import { createExpiringMap } from './expiring-map.ts';
import { createJournalWriter } from './journal-writer.ts';

/** Открытые попытки: не более 100, TTL 24 ч (engine-ts-api.md §10). */
export const MAX_OPEN_ATTEMPTS = 100;
export const OPEN_ATTEMPT_TTL_MS = 86_400_000;
/** Сколько последних замеров хранит каждая метрика. */
const METRIC_WINDOW = 1_024;

const createMetrics = (startedAt: number): EngineMetrics => {
  const samples: Record<'batch' | 'recordAttempt', number[]> = {
    batch: [],
    recordAttempt: [],
  };
  const quantile = (sorted: readonly number[], q: number) =>
    sorted.length === 0
      ? 0
      : (sorted[
          Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)
        ] ?? 0);
  return {
    startedAt,
    openLibraryMs: 0,
    rebuildMs: 0,
    record: (name, ms) => {
      const list = samples[name];
      list.push(ms);
      if (list.length > METRIC_WINDOW) list.shift();
    },
    percentiles: (name) => {
      const sorted = [...samples[name]].sort((a, b) => a - b);
      return {
        count: sorted.length,
        p50Ms: quantile(sorted, 0.5),
        p95Ms: quantile(sorted, 0.95),
      };
    },
  };
};

const createSettingChanges = (logger: Logger): ExtensionSettingChanges => {
  const listeners = new Set<(change: ExtensionSettingChangeDto) => void>();
  return {
    emit: (change) => {
      for (const listener of [...listeners]) {
        try {
          listener(change);
        } catch (error) {
          logger.error(
            { error, extensionId: change.extensionId, id: change.id },
            'extension setting listener failed',
          );
        }
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

const isKnown = (tx: StoreTx, id: string) =>
  tx.findById(id) !== null || tx.conflictRowsById(id).length > 0;

/**
 * Собирает `EngineContext`: библиотека → настройки и опции → проекции и
 * скорер → перестройка проекций из журнала (engine-ts-electron.md §4).
 * Ошибки открытия библиотеки — состояние `invalid`, а не исключение.
 */
export const createContext = async (
  deps: EngineDeps,
  config: EngineConfig,
): Promise<EngineContext> => {
  const { clock, ids, rng, logger, eventStore, courseSource, settings } = deps;
  const { memoryModel } = deps;
  const startedAt = clock.now();
  const metrics = createMetrics(startedAt);
  const state = { dirty: false, closed: false };
  const bus = createEventBus(logger);
  const library = createLibraryHolder();

  const preferences = await settings.loadPreferences();
  const options = createSchedulerOptionsHolder(
    createSchedulerOptions({
      batchSize: preferences.scheduler?.batch_size ?? null,
    }),
  );
  const savedOverrides = await settings.loadSchedulerOverrides();
  if (Object.keys(savedOverrides).length > 0) {
    try {
      options.set(savedOverrides);
    } catch (error) {
      // запуск не должен ломаться из-за устаревших сохранённых значений
      if (!(error instanceof InvalidSchedulerOptionsError)) throw error;
      logger.warn(
        { issues: error.issues },
        'saved scheduler options are invalid; defaults are used',
      );
    }
  }
  const savedFilters = new Map<string, SavedFilterDto>();
  for (const filter of await settings.listFilters()) {
    savedFilters.set(filter.id, filter);
  }

  const openStarted = performance.now();
  const rootProblem = await checkLibraryRoot(courseSource);
  const status: LibraryStatus =
    rootProblem === null
      ? await openLibrary(
          courseSource,
          { clock },
          {
            compile: {
              scan: { ignoredPaths: preferences.ignored_paths },
              checks: { exerciseTypes: deps.exerciseTypes },
            },
          },
        )
      : invalidStatus(rootProblem, clock);
  library.swap(status);
  metrics.openLibraryMs = performance.now() - openStarted;

  const currentLibrary = (): Library | null =>
    library.current()?.library ?? null;
  const fsrs = createFsrsScorer({ memory: memoryModel });
  const graph = createCurrentScoringGraph(currentLibrary);
  const projections = createProjections({
    library: currentLibrary,
    options: options.get,
    fsrs,
    memoryModel,
    graph,
    createMemoryIndex: () =>
      createMemoryIndex({
        memoryModel,
        ratingMap: fsrs.ratingMap,
        options: options.get,
      }),
  });
  const scorer = createUnitScorer({
    clock,
    graph,
    blacklist: projections.flags,
    attempts: projections.attempts,
    rewards: projections.rewards,
    exerciseTypeOf: (exerciseId) =>
      currentLibrary()?.getExercise(exerciseId)?.exercise_type ?? null,
    exerciseScorer: fsrs,
    options: options.get,
  });
  const session = createSessionState({ options: options.get, rng });
  const savedFilterSource = {
    getFilter: (id: string) => savedFilters.get(id),
  };
  const scheduler = createDepthFirstScheduler({
    clock,
    rng,
    library: library.require,
    scorer,
    blacklist: projections.flags,
    reviewList: projections.flags,
    savedFilters: savedFilterSource,
    options: options.get,
    session,
  });

  const journal = createJournalWriter({ clock, ids, eventStore });
  const emit = (event: EngineEvent): void => bus.emit(event);
  const emitLearning = (event: LearningEvent): void => bus.emitLearning(event);
  const markDirty = (): void => {
    state.dirty = true;
  };

  const invalidateDerived = (): void => {
    projections.invalidateDerived();
    scorer.invalidateWithPrefix('');
  };

  const applyEntries = (entries: readonly LogEntry[]): UnitId[] => {
    const affected = new Set<UnitId>();
    for (const entry of entries) {
      for (const unitId of projections.apply(entry)) affected.add(unitId);
    }
    if (projections.isStale()) scorer.invalidateWithPrefix('');
    else scorer.invalidate([...affected]);
    return [...affected];
  };

  const commit: EngineContext['commit'] = async (inputs) => {
    if (inputs.length === 0) {
      return { appended: [], duplicates: [], affectedUnitIds: [] };
    }
    const { appended, duplicates } = await eventStore.transact((tx) => {
      const skipped: string[] = [];
      const fresh: CommitInput[] = [];
      for (const input of inputs) {
        if (input.id !== undefined && isKnown(tx, input.id)) {
          skipped.push(input.id);
        } else fresh.push(input);
      }
      const entries = journal.buildBatch(
        fresh.map(({ fields, id, at }) => ({
          fields,
          options: {
            ...(id !== undefined && { id }),
            ...(at !== undefined && { at }),
          },
        })),
      );
      const result = appendInTx(tx, entries);
      return {
        appended: result.appended,
        duplicates: [...skipped, ...result.duplicates],
      };
    });
    for (const entry of appended) journal.commit(entry);
    try {
      return { appended, duplicates, affectedUnitIds: applyEntries(appended) };
    } catch (error) {
      markDirty(); // журнал уже записан: перестройка при следующем чтении
      throw error;
    }
  };

  const runRebuild = async (announce: boolean): Promise<void> => {
    const started = performance.now();
    try {
      const entries = await projections.rebuildFrom(eventStore.readAll());
      scorer.invalidateWithPrefix('');
      const ms = performance.now() - started;
      metrics.rebuildMs = ms;
      state.dirty = false;
      if (announce) emit({ type: 'state-rebuilt', entries, ms });
    } catch (error) {
      state.dirty = true;
      throw error;
    }
  };

  deps.extensionPolicy.update(await settings.loadExtensions());
  // окно перечитывает здоровье по событию: публикуем вне очереди команд (сбой приходит не из команды)
  deps.extensionHealth.subscribe(() => {
    if (!state.closed) bus.publish({ type: 'extension-health-changed' });
  });

  const ctx: EngineContext = {
    config,
    clock,
    ids,
    rng,
    logger,
    eventStore,
    courseSource,
    settings,
    memoryModel,
    exerciseTypes: deps.exerciseTypes,
    extensionRegistry: deps.extensionRegistry,
    extensionPolicy: deps.extensionPolicy,
    extensionHealth: deps.extensionHealth,
    extensionHostControl: deps.extensionHostControl,
    extensionInstaller: deps.extensionInstaller,
    extensionApply: createExtensionApply({
      reloader: deps.extensionReloader,
      bus,
      logger,
      state,
    }),
    folderSync: deps.folderSync ?? null,
    logReader: deps.logReader ?? null,
    platform: deps.platform ?? platformFromNode(process.platform),
    openTraneSource: deps.openTraneSource,
    repositoryStore: deps.repositoryStore,
    extensionData: deps.extensionDataStore,
    extensionSettingChanges: createSettingChanges(logger),
    snapshotFetcher: deps.snapshotFetcher,
    snapshotInstaller: deps.snapshotInstaller,
    library,
    projections,
    replica: createReplica({ store: eventStore, clock }),
    options,
    session,
    fsrs,
    scorer,
    scheduler,
    savedFilters,
    attempts: createExpiringMap<OpenAttempt>({
      capacity: MAX_OPEN_ATTEMPTS,
      ttlMs: OPEN_ATTEMPT_TTL_MS,
      clock,
    }),
    gradePolicies: deps.gradePolicies,
    extensionCommands: deps.extensionCommands,
    learning: { ...(await settings.loadLearning()) },
    journal,
    bus,
    state,
    metrics,
    getFrontier: (courseId) =>
      getFrontier(
        {
          library: library.require,
          scorer,
          blacklist: projections.flags,
          options: options.get,
        },
        courseId === undefined ? {} : { courseId },
      ),
    getDue: (minNeed) =>
      getDue(
        {
          clock,
          library: library.require,
          scorer,
          blacklist: projections.flags,
          memory: projections.memory,
          memoryModel,
          options: options.get,
        },
        minNeed === undefined ? {} : { minNeed },
      ),
    commit,
    emit,
    emitLearning,
    applyEntries,
    rebuild: () => runRebuild(true),
    markDirty,
    invalidateDerived,
  };

  await runRebuild(false);
  return ctx;
};
