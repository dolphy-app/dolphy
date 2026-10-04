export { ERRORS, EngineError, createErrorMapper } from './errors.ts';
export { prepareStorageWrite } from './extension-storage.ts';
export type {
  EngineErrorOptions,
  ErrorMapper,
  ErrorMapperDeps,
} from './errors.ts';
export { createCommandQueue } from './command-queue.ts';
export type { CommandQueue } from './command-queue.ts';
export type { EngineState, FacadeContext } from './context-types.ts';
export { createEventBus } from './event-bus.ts';
export type {
  EngineEventListener,
  EventBus,
  LearningEventListener,
} from './event-bus.ts';
export { createExpiringMap } from './expiring-map.ts';
export type { ExpiringMap, ExpiringMapOptions } from './expiring-map.ts';
export { FIVE_MIN_MS, createJournalWriter } from './journal-writer.ts';
export type {
  BuildOptions,
  EntryFields,
  JournalWriter,
  JournalWriterDeps,
} from './journal-writer.ts';
export { UNQUEUED, createFacade, wrapTree } from './facade.ts';
export type { EngineServices, WrapMethod } from './facade.ts';
export {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  decodeCursor,
  encodeCursor,
  paginate,
  resolveLimit,
} from './pagination.ts';
export {
  DEFAULT_GRAPH_LIMIT,
  DEFAULT_EXERCISE_TIMEOUT_MS,
  MAX_GRAPH_LIMIT,
  toCourseDto,
  toExerciseDto,
  toGraphDto,
  toLessonDto,
  toUnitDto,
} from './dto.ts';
export { findOrphanDiagnostics } from './orphans.ts';
export type {
  AttemptIndex,
  AttemptRecord,
  CommitInput,
  CommitResult,
  EffectiveAttempt,
  EngineContext,
  EngineDeps,
  EngineMetrics,
  EntryKey,
  ExtensionSettingChanges,
  FlagState,
  FolderSyncPort,
  LibraryHolder,
  MemoryIndex,
  OpenAttempt,
  Projections,
  RemediationTracker,
  RewardProjection,
} from './context.ts';
export { createSyncService } from './services/sync.ts';
export { createLibraryService } from './services/library.ts';
export { createCurationService } from './services/curation.ts';
export { createExtensionsService } from './services/extensions.ts';
export { createExtensionHostServices } from './services/extension-host-services.ts';
export type { ExtensionHostServices } from './services/extension-host-services.ts';
export { createExtensionValues } from './extension-values.ts';
export type { ExtensionValues } from './extension-values.ts';
export { createSettingsService } from './services/settings.ts';
export {
  createRepositoriesService,
  recoverRepositories,
} from './services/repositories.ts';
export type { RepositoriesServiceDeps } from './services/repositories.ts';
export {
  normalizeRepositoryRef,
  normalizeRepositoryUrl,
  repositorySlug,
} from './repository-url.ts';
export { createContext } from './create-context.ts';
export { createEngine, createEngineFromContext } from './create-engine.ts';
export type { HostedEngine } from './create-engine.ts';
export { createExtensionHealth } from './extension-health.ts';
export { createExtensionApply } from './extension-apply.ts';
export type { ExtensionApply } from './extension-apply.ts';
export { ENGINE_VERSION, collectDiagnostics } from './diagnostics.ts';
export { createPracticeService } from './services/practice.ts';
export { createRemediationService } from './services/remediation.ts';
export { createProgressReader } from './progress.ts';
export type { ProgressReader } from './progress.ts';
