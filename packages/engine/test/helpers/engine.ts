/**
 * Настоящий движок на тестовых портах: часы и RNG детерминированы, журнал и
 * настройки в памяти по умолчанию, библиотека — фикстура, синтетическая
 * библиотека или свой `CourseSource`.
 */
import type {
  EngineConfig,
  EngineEvent,
  LearningEvent,
} from '@dolphy-app/engine-contract';
import {
  createCapturingLogger,
  createFakeClock,
  createFakeExerciseTypes,
  createFakeExtensionCommands,
  createFakeExtensionHooks,
  createFakeExtensionRpc,
  createFakeExtensionTransfers,
  createFakeExtensionHostControl,
  createFakeExtensionInstaller,
  createFakeExtensionPolicy,
  createFakeExtensionRegistry,
  createFakeExtensionReloader,
  createFakeGradePolicies,
  createMemoryCourseSource,
  createSeededRng,
  createTestIds,
} from '@dolphy-app/testkit';
import type {
  CapturedLog,
  CourseLibrary,
  FakeClock,
  SeededRng,
  TestIds,
} from '@dolphy-app/testkit';
import {
  createContext,
  createEngineFromContext,
  createExtensionHealth,
} from '../../src/app/index.ts';
import type { HostedEngine } from '../../src/app/index.ts';
import type { EngineContext, EngineDeps } from '../../src/app/index.ts';
import {
  createMemoryEventStore,
  createMemoryExtensionDataStore,
  createMemoryRepositoryStore,
  createMemorySettingsStore,
  createNodeFsCourseSource,
  createNodeSnapshotInstaller,
} from '../../src/node/index.ts';
import { GitFetchError } from '../../src/ports/index.ts';
import type {
  CourseSource,
  EventStore,
  ExtensionDataStore,
  GitSnapshotFetcher,
  PlatformServices,
  RepositoryStore,
  SettingsStore,
  SnapshotInstaller,
} from '../../src/ports/index.ts';
import type { ExerciseTypes } from '../../src/ports/exercise-types.ts';
import type { GradePolicies } from '../../src/ports/grade-policies.ts';
import type { ExtensionCommands } from '../../src/ports/extension-commands.ts';
import type { ExtensionRpc } from '../../src/ports/extension-rpc.ts';
import type { ExtensionHooks } from '../../src/ports/extension-hooks.ts';
import type { ExtensionTransfers } from '../../src/ports/extension-transfers.ts';
import type {
  ExtensionHealth,
  ExtensionHostControl,
} from '../../src/ports/extension-health.ts';
import type { ExtensionInstaller } from '../../src/ports/extension-installer.ts';
import type { ExtensionPolicy } from '../../src/ports/extension-policy.ts';
import type { ExtensionReloader } from '../../src/ports/extension-reloader.ts';
import type { LogReader } from '../../src/ports/log-reader.ts';
import type { ExtensionRegistry } from '../../src/ports/extension-registry.ts';
import { createTsFsrsMemoryModel } from '../../src/scoring/memory-model.ts';
import { LIBRARIES_DIR } from './fixtures.ts';

/** Библиотеки-фикстуры по имени. */
export const FIXTURE_LIBRARIES = {
  embedded: `${LIBRARIES_DIR}/trane-embedded`,
  small: `${LIBRARIES_DIR}/trane-small`,
  'sql-course': `${LIBRARIES_DIR}/sql-course/lib_json`,
  'sql-course-kb': `${LIBRARIES_DIR}/sql-course/lib_kb`,
} as const;

export type FixtureLibraryName = keyof typeof FIXTURE_LIBRARIES;

export interface TestEngineOptions {
  /** Фикстура, синтетическая библиотека (`@dolphy-app/testkit`) или готовый источник. По умолчанию `embedded`. */
  library?: FixtureLibraryName | CourseLibrary | CourseSource;
  /** По умолчанию `createMemoryEventStore({ deviceId })`. */
  eventStore?: EventStore;
  deviceId?: string;
  settings?: SettingsStore;
  exerciseTypes?: ExerciseTypes;
  gradePolicies?: GradePolicies;
  extensionCommands?: ExtensionCommands;
  extensionRpc?: ExtensionRpc;
  extensionHooks?: ExtensionHooks;
  extensionTransfers?: ExtensionTransfers;
  extensionRegistry?: ExtensionRegistry;
  extensionPolicy?: ExtensionPolicy;
  /** По умолчанию — `createExtensionHealth(clock)`. */
  extensionHealth?: ExtensionHealth;
  extensionHostControl?: ExtensionHostControl;
  extensionInstaller?: ExtensionInstaller;
  extensionReloader?: ExtensionReloader;
  logReader?: LogReader;
  clock?: FakeClock;
  seed?: number;
  config?: Partial<EngineConfig>;
  osPlatform?: EngineDeps['osPlatform'];
  folderSync?: EngineDeps['folderSync'];
  openTraneSource?: EngineDeps['openTraneSource'];
  repositoryStore?: RepositoryStore;
  /** По умолчанию — `createMemoryExtensionDataStore()`. */
  extensionDataStore?: ExtensionDataStore;
  /** По умолчанию — платформа без хранилища ключей (`createUnavailablePlatform()`). */
  platform?: PlatformServices;
  /** По умолчанию — без сети (`GIT_FETCH_FAILED/network`). */
  snapshotFetcher?: GitSnapshotFetcher;
  /** По умолчанию — `createNodeSnapshotInstaller` над `libraryRoot` и `dataDir`. */
  snapshotInstaller?: SnapshotInstaller;
}

export interface TestContext {
  ctx: EngineContext;
  deps: EngineDeps;
  clock: FakeClock;
  rng: SeededRng;
  ids: TestIds;
  source: CourseSource;
  eventStore: EventStore;
  settings: SettingsStore;
  extensionDataStore: ExtensionDataStore;
  logs: CapturedLog[];
}

/** Фикстура открывается только на чтение: артефакт не пишется в репозиторий. */
const readOnly = (source: CourseSource): CourseSource => ({
  root: source.root,
  list: (dir) => source.list(dir),
  readText: (path) => source.readText(path),
  readBytes: (path) => source.readBytes(path),
  stat: (path) => source.stat(path),
  readArtifact: async () => null,
  writeArtifact: async () => {
    throw new Error('read-only fixture');
  },
});

const isCourseLibrary = (value: unknown): value is CourseLibrary =>
  typeof value === 'object' && value !== null && 'exercises' in value;

const sourceOf = (library: TestEngineOptions['library']): CourseSource => {
  if (library === undefined) {
    return readOnly(createNodeFsCourseSource(FIXTURE_LIBRARIES.embedded));
  }
  if (typeof library === 'string') {
    return readOnly(createNodeFsCourseSource(FIXTURE_LIBRARIES[library]));
  }
  return isCourseLibrary(library) ? createMemoryCourseSource(library) : library;
};

/** Сети нет: `repositories.add` падает `GIT_FETCH_FAILED/network`. */
const offlineFetcher: GitSnapshotFetcher = {
  resolve: async () => {
    throw new GitFetchError('network', 'offline');
  },
  fetchSnapshot: async () => {
    throw new GitFetchError('network', 'offline');
  },
};

export const createTestContext = async (
  options: TestEngineOptions = {},
): Promise<TestContext> => {
  const clock = options.clock ?? createFakeClock();
  const rng = createSeededRng(options.seed ?? 1);
  const ids = createTestIds('e');
  const { logger, records: logs } = createCapturingLogger();
  const source = sourceOf(options.library);
  const eventStore =
    options.eventStore ??
    createMemoryEventStore({ deviceId: options.deviceId ?? 'device-a' });
  const settings = options.settings ?? createMemorySettingsStore();
  const config: EngineConfig = {
    libraryRoot: source.root,
    dataDir: '/tmp/engine-test-data',
    ...options.config,
  };
  const repositoryStore =
    options.repositoryStore ?? createMemoryRepositoryStore();
  const extensionDataStore =
    options.extensionDataStore ?? createMemoryExtensionDataStore();
  const deps: EngineDeps = {
    clock,
    rng,
    ids,
    logger,
    courseSource: source,
    eventStore,
    settings,
    memoryModel: createTsFsrsMemoryModel(),
    exerciseTypes: options.exerciseTypes ?? createFakeExerciseTypes(),
    gradePolicies: options.gradePolicies ?? createFakeGradePolicies(),
    extensionCommands:
      options.extensionCommands ?? createFakeExtensionCommands(),
    extensionRpc: options.extensionRpc ?? createFakeExtensionRpc(),
    extensionHooks: options.extensionHooks ?? createFakeExtensionHooks(),
    extensionTransfers:
      options.extensionTransfers ?? createFakeExtensionTransfers(),
    extensionRegistry:
      options.extensionRegistry ?? createFakeExtensionRegistry(),
    extensionPolicy: options.extensionPolicy ?? createFakeExtensionPolicy(),
    extensionHealth: options.extensionHealth ?? createExtensionHealth(clock),
    extensionHostControl:
      options.extensionHostControl ?? createFakeExtensionHostControl(),
    extensionInstaller:
      options.extensionInstaller ?? createFakeExtensionInstaller(),
    extensionReloader:
      options.extensionReloader ?? createFakeExtensionReloader(),
    repositoryStore,
    extensionDataStore,
    ...(options.osPlatform !== undefined && {
      osPlatform: options.osPlatform,
    }),
    snapshotFetcher: options.snapshotFetcher ?? offlineFetcher,
    snapshotInstaller:
      options.snapshotInstaller ??
      createNodeSnapshotInstaller({
        libraryRoot: config.libraryRoot,
        dataDir: config.dataDir,
      }),
    ...(options.folderSync !== undefined && { folderSync: options.folderSync }),
    ...(options.logReader !== undefined && { logReader: options.logReader }),
    ...(options.platform !== undefined && { platform: options.platform }),
    ...(options.openTraneSource !== undefined && {
      openTraneSource: options.openTraneSource,
    }),
  };
  const ctx = await createContext(deps, config);
  return {
    ctx,
    deps,
    clock,
    rng,
    ids,
    source,
    eventStore,
    settings,
    extensionDataStore,
    logs,
  };
};

export interface TestEngine extends TestContext {
  engine: HostedEngine;
  /** События, доставленные подписчикам, по порядку. */
  events: EngineEvent[];
  /** События обучения, доставленные приёмнику, по порядку. */
  learning: LearningEvent[];
}

export const createTestEngine = async (
  options: TestEngineOptions = {},
): Promise<TestEngine> => {
  const context = await createTestContext(options);
  const engine = createEngineFromContext(context.ctx);
  const events: EngineEvent[] = [];
  engine.subscribe((event) => events.push(event));
  const learning: LearningEvent[] = [];
  engine.onLearningEvent((event) => {
    learning.push(event);
  });
  return { ...context, engine, events, learning };
};
