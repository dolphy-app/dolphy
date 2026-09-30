/**
 * Настоящий движок на тестовых портах: часы и RNG детерминированы, журнал и
 * настройки в памяти по умолчанию, библиотека — фикстура, синтетическая
 * библиотека или свой `CourseSource`.
 */
import type {
  EngineConfig,
  EngineEvent,
  LearningEngine,
} from '@spirula-app/engine-contract';
import {
  createCapturingLogger,
  createFakeClock,
  createFakeExerciseTypes,
  createFakeExtensionInstaller,
  createFakeExtensionPolicy,
  createFakeExtensionRegistry,
  createFakeGradePolicies,
  createMemoryCourseSource,
  createSeededRng,
  createTestIds,
} from '@spirula-app/testkit';
import type {
  CapturedLog,
  CourseLibrary,
  FakeClock,
  SeededRng,
  TestIds,
} from '@spirula-app/testkit';
import { createContext, createEngineFromContext } from '../../src/app/index.ts';
import type { EngineContext, EngineDeps } from '../../src/app/index.ts';
import {
  createMemoryEventStore,
  createMemoryRepositoryStore,
  createMemorySettingsStore,
  createNodeFsCourseSource,
  createNodeSnapshotInstaller,
} from '../../src/node/index.ts';
import { GitFetchError } from '../../src/ports/index.ts';
import type {
  CourseSource,
  EventStore,
  GitSnapshotFetcher,
  RepositoryStore,
  SettingsStore,
  SnapshotInstaller,
} from '../../src/ports/index.ts';
import type { ExerciseTypes } from '../../src/ports/exercise-types.ts';
import type { GradePolicies } from '../../src/ports/grade-policies.ts';
import type { ExtensionInstaller } from '../../src/ports/extension-installer.ts';
import type { ExtensionPolicy } from '../../src/ports/extension-policy.ts';
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
  /** Фикстура, синтетическая библиотека (`@spirula-app/testkit`) или готовый источник. По умолчанию `embedded`. */
  library?: FixtureLibraryName | CourseLibrary | CourseSource;
  /** По умолчанию `createMemoryEventStore({ deviceId })`. */
  eventStore?: EventStore;
  deviceId?: string;
  settings?: SettingsStore;
  exerciseTypes?: ExerciseTypes;
  gradePolicies?: GradePolicies;
  extensionRegistry?: ExtensionRegistry;
  extensionPolicy?: ExtensionPolicy;
  extensionInstaller?: ExtensionInstaller;
  clock?: FakeClock;
  seed?: number;
  config?: Partial<EngineConfig>;
  folderSync?: EngineDeps['folderSync'];
  openTraneSource?: EngineDeps['openTraneSource'];
  repositoryStore?: RepositoryStore;
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
    extensionRegistry:
      options.extensionRegistry ?? createFakeExtensionRegistry(),
    extensionPolicy: options.extensionPolicy ?? createFakeExtensionPolicy(),
    extensionInstaller:
      options.extensionInstaller ?? createFakeExtensionInstaller(),
    repositoryStore,
    snapshotFetcher: options.snapshotFetcher ?? offlineFetcher,
    snapshotInstaller:
      options.snapshotInstaller ??
      createNodeSnapshotInstaller({
        libraryRoot: config.libraryRoot,
        dataDir: config.dataDir,
      }),
    ...(options.folderSync !== undefined && { folderSync: options.folderSync }),
    ...(options.openTraneSource !== undefined && {
      openTraneSource: options.openTraneSource,
    }),
  };
  const ctx = await createContext(deps, config);
  return { ctx, deps, clock, rng, ids, source, eventStore, settings, logs };
};

export interface TestEngine extends TestContext {
  engine: LearningEngine;
  /** События, доставленные подписчикам, по порядку. */
  events: EngineEvent[];
}

export const createTestEngine = async (
  options: TestEngineOptions = {},
): Promise<TestEngine> => {
  const context = await createTestContext(options);
  const engine = createEngineFromContext(context.ctx);
  const events: EngineEvent[] = [];
  engine.subscribe((event) => events.push(event));
  return { ...context, engine, events };
};
