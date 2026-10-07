/**
 * Клиент `@dolphy-app/engine-rpc` → диспетчер → настоящий `createEngine` через
 * in-process пару (structuredClone на каждом сообщении, как в Electron).
 */
import { RPC_METHODS } from '@dolphy-app/engine-contract';
import type {
  CatalogDto,
  CommandContributionDto,
  EngineEvent,
  ExporterContributionDto,
  ExtensionInfoDto,
  ImporterContributionDto,
  ExtensionClientDto,
  ScheduleContributionDto,
  ExtensionSettingDefDto,
  ExtensionUpdateDto,
  SavedFilterDto,
} from '@dolphy-app/engine-contract';
import { createEngine, createExtensionHealth } from '@dolphy-app/engine/app';
import {
  createMemoryEventStore,
  createMemoryExtensionDataStore,
  createMemoryRepositoryStore,
  createMemorySettingsStore,
  createNodeSnapshotInstaller,
} from '@dolphy-app/engine/node';
import { GitFetchError } from '@dolphy-app/engine/ports';
import type { GitSnapshotFetcher } from '@dolphy-app/engine/ports';
import { createTsFsrsMemoryModel } from '@dolphy-app/engine';
import {
  buildAttempt,
  buildExercise,
  buildLibrary,
  createFakeClock,
  createFakeExtensionCommands,
  createFakeExtensionHooks,
  createFakeExtensionRpc,
  createFakeExtensionTransfers,
  createFakeExerciseTypes,
  createFakeExtensionHostControl,
  createFakeLogReader,
  createFakeExtensionInstaller,
  createFakeExtensionPolicy,
  createFakeExtensionRegistry,
  createFakeExtensionReloader,
  createFakeGradePolicies,
  createMemoryCourseSource,
  createSeededRng,
  createTestIds,
  silentLogger,
  T0_MS,
} from '@dolphy-app/testkit';
import { describe, expect, it } from 'vitest';
import { EngineCallError, createEngineClient } from '../../src/client/index.ts';
import { createDispatcher, schemas } from '../../src/host/index.ts';
import { createInProcessPair } from '../../src/in-process.ts';

const library = buildLibrary({
  courses: [
    {
      id: 'c',
      lessons: [
        { id: 'l1', exercises: 2 },
        { id: 'l2', dependencies: ['l1'], exercises: 2 },
        { id: 'l3', dependencies: ['l2'], exercises: 2 },
        { id: 'l4', dependencies: ['l3'], exercises: 2 },
      ],
    },
  ],
});
const VERIFIABLE = 'c::l1::v0';
library.exercises.push(
  buildExercise({
    id: VERIFIABLE,
    engine: { exercise: { type: 'dolphy.sql', timeoutMs: 500, spec: {} } },
  }),
);
const E1 = 'c::l1::e0';
const REGISTERED: ExtensionInfoDto = {
  id: 'dolphy.sql',
  version: '1.0.0',
  origin: 'bundled',
  state: 'loaded',
  contributes: {
    exerciseTypes: ['dolphy.sql'],
    gradePolicies: [],
    settings: ['dolphy.sql.rows'],
    events: [],
    commands: ['dolphy.sql.stats'],
    schedules: ['dolphy.sql.nightly'],
    importers: [],
    exporters: [],
  },
  diagnostics: [],
  toggleable: false,
  name: null,
  description: null,
  author: null,
  dependencies: [],
  installed: null,
  icon: null,
  tags: [],
  removable: false,
  revoked: null,
  deprecated: null,
};
const USER_EXTENSION: ExtensionInfoDto = {
  ...REGISTERED,
  id: 'acme.user',
  origin: 'user',
  contributes: {
    ...REGISTERED.contributes,
    exerciseTypes: [],
    settings: [],
    commands: [],
    schedules: [],
    importers: [],
    exporters: [],
  },
  toggleable: true,
  icon: null,
  tags: [],
  removable: true,
};

const ROWS_SETTING: ExtensionSettingDefDto = {
  id: 'dolphy.sql.rows',
  extensionId: 'dolphy.sql',
  type: 'number',
  label: 'Rows',
  description: null,
  group: null,
  order: 0,
  visibleWhen: null,
  default: 10,
  min: 1,
  max: 100,
  integer: true,
};

const STATS_COMMAND: CommandContributionDto = {
  id: 'dolphy.sql.stats',
  extensionId: 'dolphy.sql',
  title: 'Show stats',
  description: null,
  category: null,
  keybindings: [],
  icon: 'puzzle',
  palette: true,
  when: "route == 'courses'",
};
const SQL_CLIENT: ExtensionClientDto = {
  extensionId: 'dolphy.sql',
  url: 'dolphy-ext://dolphy.sql/client.mjs',
  origin: 'bundled',
  revision: '',
};
const SQL_SCHEDULE: ScheduleContributionDto = {
  id: 'dolphy.sql.nightly',
  extensionId: 'dolphy.sql',
  every: 'daily',
  at: '09:00',
};

const LOG_ENTRY = {
  at: 1_700_000_000_000,
  level: 'warn',
  source: 'ext-host',
  message: 'boom',
  extensionId: 'acme.user',
  details: null,
} as const;

const CATALOG: CatalogDto = {
  entries: [],
  fetchedAt: '2026-10-01T00:00:00.000Z',
  stale: false,
  error: null,
};
const UPDATE: ExtensionUpdateDto = {
  id: 'acme.user',
  name: 'Acme',
  installed: '1.0.0',
  available: {
    version: '1.1.0',
    dependencies: [],
    publishedAt: '2026-10-01T00:00:00.000Z',
    size: 10,
    minAppVersion: null,
  },
};

const IMPORT_BYTES: ImporterContributionDto = {
  id: 'dolphy.sql.import',
  extensionId: 'dolphy.sql',
  title: 'Import',
  accept: ['.bin'],
  input: 'bytes',
};
const EXPORT_PROGRESS: ExporterContributionDto = {
  id: 'dolphy.sql.export',
  extensionId: 'dolphy.sql',
  title: 'Export',
  scope: 'progress',
};

/** Вид задания, всегда отвечающий `passed`: проверяет путь вердикта через RPC. */
const passingTypes = () =>
  createFakeExerciseTypes({
    types: {
      'dolphy.sql': { script: [{ outcome: 'passed', durationMs: 1 }] },
    },
  });

/** Сеть недоступна: любой вызов падает как `GIT_FETCH_FAILED/network`. */
const offlineFetcher: GitSnapshotFetcher = {
  resolve: async () => {
    throw new GitFetchError('network', 'offline');
  },
  fetchSnapshot: async () => {
    throw new GitFetchError('network', 'offline');
  },
};

const start = async () => {
  const clock = createFakeClock();
  const source = createMemoryCourseSource(library);
  const engine = await createEngine(
    {
      clock,
      rng: createSeededRng(1),
      ids: createTestIds('e'),
      logger: silentLogger,
      courseSource: source,
      eventStore: createMemoryEventStore({ deviceId: 'device-a' }),
      settings: createMemorySettingsStore(),
      memoryModel: createTsFsrsMemoryModel(),
      exerciseTypes: passingTypes(),
      gradePolicies: createFakeGradePolicies(),
      extensionCommands: createFakeExtensionCommands({
        'dolphy.sql/dolphy.sql.stats': () => ({
          kind: 'notify',
          text: '42 rows',
        }),
      }),
      extensionHooks: createFakeExtensionHooks(),
      extensionRpc: createFakeExtensionRpc({
        'dolphy.sql/greeting.say-hello': (input) => ({ greeting: input }),
      }),
      extensionTransfers: createFakeExtensionTransfers({
        exporters: {
          'dolphy.sql/dolphy.sql.export': () => ({
            filename: 'progress.bin',
            bytes: new Uint8Array([1, 2, 3]),
          }),
        },
      }),
      extensionRegistry: createFakeExtensionRegistry(
        [REGISTERED, USER_EXTENSION],
        {
          exerciseTypes: [],
          gradePolicies: [],
          settings: [ROWS_SETTING],
          commands: [STATS_COMMAND],
          schedules: [SQL_SCHEDULE],
          importers: [IMPORT_BYTES],
          exporters: [EXPORT_PROGRESS],
          clients: [SQL_CLIENT],
        },
      ),
      extensionPolicy: createFakeExtensionPolicy(),
      extensionHealth: createExtensionHealth(clock),
      extensionHostControl: createFakeExtensionHostControl(),
      extensionInstaller: createFakeExtensionInstaller({
        catalog: CATALOG,
        updates: [UPDATE],
        handlers: {
          docs: (_id, version) => ({
            version: version ?? '2.0.0',
            readme: '# New',
            changelog: null,
            truncated: false,
            source: 'catalog',
          }),
          docImage: () => 'data:image/png;base64,AA==',
        },
      }),
      extensionReloader: createFakeExtensionReloader(),
      logReader: createFakeLogReader([LOG_ENTRY]),
      repositoryStore: createMemoryRepositoryStore(),
      extensionDataStore: createMemoryExtensionDataStore(),
      snapshotFetcher: offlineFetcher,
      snapshotInstaller: createNodeSnapshotInstaller({
        libraryRoot: source.root,
        dataDir: '/tmp/rpc-integration',
      }),
    },
    { libraryRoot: source.root, dataDir: '/tmp/rpc-integration' },
  );
  const dispatcher = createDispatcher({
    engine,
    schemas,
    logger: silentLogger,
    verifyCloneable: true,
  });
  const [hostSide, clientSide] = createInProcessPair();
  dispatcher.attach(hostSide, 'window-1');
  const client = createEngineClient();
  await client.attach(clientSide);
  return { engine, client: client.engine, clock };
};

describe('rpc → dispatcher → real engine', () => {
  it('recordAttempt through RPC is idempotent', async () => {
    const { client } = await start();
    const request = { requestId: 'r1', exerciseId: E1, grade: 5 } as const;
    const first = await client.practice.recordAttempt(request);
    const second = await client.practice.recordAttempt(request);
    expect(first).toMatchObject({ eventId: 'r1', duplicate: false });
    expect(second).toMatchObject({ eventId: first.eventId, duplicate: true });
    expect((await client.practice.getAttempts(E1)).items).toHaveLength(1);
  });

  it('pushes engine events to subscribers after the command', async () => {
    const { client } = await start();
    const events: EngineEvent[] = [];
    const unsubscribe = client.subscribe((event) => events.push(event));
    await client.practice.recordAttempt({
      requestId: 'r1',
      exerciseId: E1,
      grade: 4,
    });
    await client.curation.blacklist.add('c::l4');
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(events.map(({ type }) => type)).toEqual([
      'progress',
      'settings-changed',
    ]);
    unsubscribe();
  });

  it('carries engine errors as EngineCallError with code and retryable', async () => {
    const { client } = await start();
    await expect(
      client.practice.recordAttempt({
        requestId: 'r1',
        exerciseId: 'nope',
        grade: 4,
      }),
    ).rejects.toMatchObject({
      name: expect.any(String),
      code: 'NOT_FOUND',
      retryable: false,
    });
    await expect(
      client.practice
        .recordAttempt({ requestId: 'r1', exerciseId: E1, grade: 4 })
        .then(() => client.practice.getAttempts('nope')),
    ).rejects.toBeInstanceOf(EngineCallError);
  });

  it('validates params on the host: a bad grade never reaches the engine', async () => {
    const { client, engine } = await start();
    const before = (await engine.sync.getState()).entryCount;
    await expect(
      client.practice.recordAttempt({
        requestId: 'r',
        exerciseId: E1,
        grade: 9 as 5,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect((await engine.sync.getState()).entryCount).toBe(before);
  });

  it.each([0, 1])(
    'resolves an id-content conflict by entryHash through RPC (side %i)',
    async (index) => {
      const { client } = await start();
      const original = buildAttempt({
        id: 'same-id',
        deviceId: 'device-x',
        seq: 1,
        at: T0_MS + 10,
        exerciseId: E1,
        grade: 5,
      });
      const forged = { ...original, grade: 1 } as const;
      await client.sync.import([original]);
      await client.sync.import([forged]);

      const [conflict] = (await client.sync.getConflicts()).items;
      expect(conflict!.entryHashes).toHaveLength(2);
      const chosen = conflict!.entries[index]!;
      const chosenGrade = chosen.kind === 'attempt' ? chosen.grade : null;
      const result = await client.sync.resolveConflict({
        conflictId: conflict!.conflictId,
        keep: conflict!.entryHashes[index]!,
      });
      expect(result).toMatchObject({ kept: 'same-id', rebuilt: true });
      expect(
        (await client.practice.getAttempts(E1)).items.map(({ grade }) => grade),
      ).toEqual([chosenGrade]);
      expect(await client.sync.import([original, forged])).toMatchObject({
        inserted: 0,
        conflicts: 0,
      });
      expect((await client.sync.getConflicts()).items).toEqual([]);
    },
  );

  it('every method of RPC_METHODS is callable end to end and its result survives structured clone', async () => {
    const { client, clock } = await start();
    const called = new Set<string>();
    const call = async <T>(
      name: keyof typeof RPC_METHODS,
      run: () => Promise<T>,
    ) => {
      called.add(name);
      return run();
    };

    await call('library.getInfo', () => client.library.getInfo());
    await call('library.getDiagnostics', () => client.library.getDiagnostics());
    await call('library.validate', () => client.library.validate());
    await call('library.compile', () => client.library.compile());
    await call('library.reload', () => client.library.reload());
    await call('library.listCourses', () => client.library.listCourses());
    await call('library.listLessons', () => client.library.listLessons('c'));
    await call('library.listExercises', () =>
      client.library.listExercises('c::l1'),
    );
    await call('library.getUnit', () => client.library.getUnit(E1));
    await call('library.matchPrefix', () =>
      client.library.matchPrefix('c::', 'lesson'),
    );
    await call('library.getGraph', () => client.library.getGraph());
    await call('library.readAsset', async () => {
      const unit = await client.library.getUnit(E1);
      if (unit.kind !== 'exercise' || unit.content.type !== 'flashcard') {
        throw new Error('expected a flashcard');
      }
      return client.library.readAsset(unit.content.front);
    });

    expect(
      await call('repositories.list', () => client.repositories.list()),
    ).toEqual([]);
    await call('repositories.preview', () =>
      client.repositories
        .preview({ url: 'https://example.com/a.git' })
        .catch((error) => {
          expect(error).toMatchObject({
            code: 'GIT_FETCH_FAILED',
            details: { reason: 'network' },
          });
        }),
    );
    await call('repositories.add', () =>
      client.repositories
        .add({ url: 'https://example.com/a.git' })
        .catch((error) => {
          expect(error).toMatchObject({
            code: 'GIT_FETCH_FAILED',
            details: { reason: 'network' },
          });
        }),
    );
    await call('repositories.update', () =>
      client.repositories.update('nope').catch((error) => {
        expect(error).toMatchObject({ code: 'NOT_FOUND' });
      }),
    );
    await call('repositories.remove', () =>
      client.repositories
        .remove('nope', { removeProgress: true })
        .catch((error) => {
          expect(error).toMatchObject({ code: 'NOT_FOUND' });
        }),
    );
    expect(
      await call('repositories.cancel', () =>
        client.repositories.cancel('nope'),
      ),
    ).toBe(false);
    // реестр пуст: проверять нечего, вызов не падает и событий не даёт
    expect(
      await call('repositories.checkUpdates', () =>
        client.repositories.checkUpdates(),
      ),
    ).toEqual([]);

    const started = await call('practice.startSession', () =>
      client.practice.startSession(),
    );
    expect(
      await call('practice.finishSession', () =>
        client.practice.finishSession({ sessionId: started.sessionId }),
      ),
    ).toEqual({ emitted: true });
    await call('practice.getBatch', () => client.practice.getBatch());
    const attempt = await call('practice.beginAttempt', () =>
      client.practice.beginAttempt({ exerciseId: E1 }),
    );
    await call('practice.completeAttempt', () =>
      client.practice.completeAttempt({
        attemptId: attempt.attemptId,
        grade: 4,
      }),
    );
    const checked = await client.practice.beginAttempt({
      exerciseId: VERIFIABLE,
    });
    const verdict = await call('practice.submitAnswer', () =>
      client.practice.submitAnswer({
        attemptId: checked.attemptId,
        answer: 'select 1',
      }),
    );
    expect(verdict).toMatchObject({ outcome: 'passed', attemptsUsed: 1 });
    expect(
      await client.practice.completeAttempt({ attemptId: checked.attemptId }),
    ).toMatchObject({ grade: 5 });
    await call('practice.recordAttempt', () =>
      client.practice.recordAttempt({
        requestId: 'r2',
        exerciseId: 'c::l1::e1',
        grade: 5,
      }),
    );
    await call('practice.getUnitScore', () =>
      client.practice.getUnitScore('c::l1'),
    );
    await call('practice.getAttempts', () => client.practice.getAttempts(E1));
    await call('practice.getProgress', () =>
      client.practice.getProgress({ includeExercises: true }),
    );
    await call('practice.getFrontier', () => client.practice.getFrontier());
    clock.advance(60 * 86_400_000);
    await call('practice.getDue', () => client.practice.getDue());
    await call('practice.resetProgress', () =>
      client.practice.resetProgress({ unitId: 'c::l4', requestId: 'reset' }),
    );
    expect(
      await call('practice.undo', () =>
        client.practice.undo({ targetId: 'r2', requestId: 'undo-r2' }),
      ),
    ).toEqual({ eventId: 'undo-r2', duplicate: false, changed: true });
    expect(
      await call('practice.redo', () =>
        client.practice.redo({ targetId: 'r2', requestId: 'redo-r2' }),
      ),
    ).toEqual({ eventId: 'redo-r2', duplicate: false, changed: true });

    await call('curation.blacklist.list', () =>
      client.curation.blacklist.list(),
    );
    await call('curation.blacklist.has', () =>
      client.curation.blacklist.has('c::l4'),
    );
    await call('curation.blacklist.add', () =>
      client.curation.blacklist.add('c::l4'),
    );
    await call('curation.blacklist.remove', () =>
      client.curation.blacklist.remove('c::l4'),
    );
    await call('curation.blacklist.removePrefix', () =>
      client.curation.blacklist.removePrefix('c::l'),
    );
    await call('curation.reviewList.list', () =>
      client.curation.reviewList.list(),
    );
    await call('curation.reviewList.has', () =>
      client.curation.reviewList.has(E1),
    );
    await call('curation.reviewList.add', () =>
      client.curation.reviewList.add(E1),
    );
    await call('curation.reviewList.remove', () =>
      client.curation.reviewList.remove(E1),
    );
    await call('curation.reviewList.removePrefix', () =>
      client.curation.reviewList.removePrefix('c::'),
    );
    const filter: SavedFilterDto = {
      id: 'f',
      description: 'lesson 1',
      filter: { LessonFilter: { lesson_ids: ['c::l1'] } },
    };
    await call('curation.filters.save', () =>
      client.curation.filters.save(filter),
    );
    await call('curation.filters.list', () => client.curation.filters.list());
    await call('curation.filters.get', () => client.curation.filters.get('f'));
    await call('curation.filters.delete', () =>
      client.curation.filters.delete('f'),
    );
    const session = { id: 's', parts: [{ NoFilter: { duration: 10 } }] };
    await call('curation.sessions.save', () =>
      client.curation.sessions.save(session),
    );
    await call('curation.sessions.list', () => client.curation.sessions.list());
    await call('curation.sessions.get', () =>
      client.curation.sessions.get('s'),
    );
    await call('curation.sessions.delete', () =>
      client.curation.sessions.delete('s'),
    );

    await call('settings.getScheduler', () => client.settings.getScheduler());
    await call('settings.setScheduler', () =>
      client.settings.setScheduler({ batchSize: 20 }),
    );
    await call('settings.resetScheduler', () =>
      client.settings.resetScheduler(),
    );
    await call('settings.getPreferences', () =>
      client.settings.getPreferences(),
    );
    await call('settings.setPreferences', () =>
      client.settings.setPreferences({ ignoredPaths: [] }),
    );
    await call('settings.getScorer', () => client.settings.getScorer());
    await call('settings.getUi', () => client.settings.getUi());
    await call('settings.getLearning', () => client.settings.getLearning());
    await call('settings.setLearning', () =>
      client.settings.setLearning({ gradePolicy: 'acme.policy' }),
    );
    await call('settings.getKeybindings', () =>
      client.settings.getKeybindings(),
    );
    await call('settings.setKeybindings', () =>
      client.settings.setKeybindings({
        'app:palette.open': [{ key: 'Mod+Shift+P', when: null }],
      }),
    );
    await call('settings.setUi', () =>
      client.settings.setUi({ theme: 'dark', locale: 'en' }),
    );

    await call('plan.getDay', () =>
      client.plan.getDay({ maxItems: 10, seed: 1 }),
    );
    await call('remediation.getPlan', () =>
      client.remediation.getPlan({ exerciseId: E1 }),
    );
    const placement = await call('placement.start', () =>
      client.placement.start({ budget: 3, seed: 1 }),
    );
    const probe = await call('placement.nextProbe', () =>
      client.placement.nextProbe(placement.sessionId),
    );
    if (probe !== null) {
      await call('placement.answer', () =>
        client.placement.answer({
          probeId: probe.probeId,
          result: { kind: 'grade', grade: 4 },
        }),
      );
    } else {
      called.add('placement.answer');
    }
    expect(
      await call('placement.undo', () =>
        client.placement.undo(placement.sessionId),
      ),
    ).toMatchObject({ changed: probe !== null });
    expect(
      await call('placement.redo', () =>
        client.placement.redo(placement.sessionId),
      ),
    ).toMatchObject({ changed: probe !== null });
    await call('placement.finish', () =>
      client.placement.finish({
        sessionId: placement.sessionId,
        requestId: 'fin',
      }),
    );
    await call('placement.abort', () =>
      client.placement.abort({ sessionId: 'unknown' }),
    );

    const state = await call('sync.getState', () => client.sync.getState());
    expect(state.entryCount).toBeGreaterThan(0);
    const exported = await call('sync.exportSince', () =>
      client.sync.exportSince(),
    );
    await call('sync.import', () => client.sync.import(exported.entries));
    await call('sync.rebuild', () => client.sync.rebuild());
    await call('sync.getConflicts', () => client.sync.getConflicts());
    await call('sync.resolveConflict', () =>
      client.sync
        .resolveConflict({ conflictId: 'nope', keep: 'none' })
        .catch((error) => {
          expect(error).toMatchObject({ code: 'SYNC_CONFLICT_NOT_FOUND' });
        }),
    );
    await call('sync.importFromTrane', () =>
      client.sync.importFromTrane({ traneDir: '/nowhere' }).catch((error) => {
        expect(error).toBeInstanceOf(EngineCallError);
      }),
    );
    await call('sync.folder.configure', () =>
      client.sync.folder.configure({ dir: '/nowhere' }).catch((error) => {
        expect(error).toBeInstanceOf(EngineCallError);
      }),
    );
    await call('sync.folder.sync', () =>
      client.sync.folder.sync().catch((error) => {
        expect(error).toMatchObject({ code: 'SYNC_FOLDER_NOT_CONFIGURED' });
      }),
    );
    await call('sync.folder.checkRestore', () =>
      client.sync.folder.checkRestore().catch((error) => {
        expect(error).toMatchObject({ code: 'SYNC_FOLDER_NOT_CONFIGURED' });
      }),
    );
    expect(
      await call('extensions.list', () => client.extensions.list()),
    ).toEqual([USER_EXTENSION, REGISTERED]);
    expect(
      await call('extensions.getSettings', () =>
        client.extensions.getSettings(),
      ),
    ).toEqual({
      disabled: [],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
      schedulesOff: [],
    });
    expect(
      await call('extensions.getSettingValues', () =>
        client.extensions.getSettingValues('dolphy.sql'),
      ),
    ).toEqual({ 'dolphy.sql.rows': 10 });
    expect(
      await call('extensions.setSettingValue', () =>
        client.extensions.setSettingValue('dolphy.sql', 'dolphy.sql.rows', 25),
      ),
    ).toEqual({ 'dolphy.sql.rows': 25 });
    await expect(
      client.extensions.setSettingValue('dolphy.sql', 'dolphy.sql.rows', 1.5),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { reason: 'integer' },
    });
    expect(
      await call('extensions.dataUsage', () =>
        client.extensions.dataUsage('dolphy.sql'),
      ),
    ).toEqual({
      storage: { keys: 0, bytes: 0 },
      settings: { keys: 1, bytes: 2 },
      secrets: { keys: 0, bytes: 0 },
    });
    expect(
      await call('extensions.resetSettingValues', () =>
        client.extensions.resetSettingValues('dolphy.sql'),
      ),
    ).toEqual({ 'dolphy.sql.rows': 10 });
    await call('extensions.clearData', () =>
      client.extensions.clearData('dolphy.sql'),
    );
    expect(
      await call('extensions.setEnabled', () =>
        client.extensions.setEnabled('acme.user', false),
      ),
    ).toEqual({
      disabled: ['acme.user'],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
      schedulesOff: [],
    });
    expect(
      await call('extensions.setNotificationsEnabled', () =>
        client.extensions.setNotificationsEnabled('acme.user', false),
      ),
    ).toEqual({
      disabled: ['acme.user'],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: ['acme.user'],
      catalogUrl: null,
      schedulesOff: [],
    });
    expect(
      await call('extensions.setSchedulesEnabled', () =>
        client.extensions.setSchedulesEnabled('acme.user', false),
      ),
    ).toEqual({
      disabled: ['acme.user'],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: ['acme.user'],
      catalogUrl: null,
      schedulesOff: ['acme.user'],
    });
    expect(
      await call('extensions.setCheckUpdates', () =>
        client.extensions.setCheckUpdates(false),
      ),
    ).toMatchObject({ checkUpdates: false, safeMode: false });
    expect(
      await call('extensions.setCatalogUrl', () =>
        client.extensions.setCatalogUrl('https://example.test/index.json'),
      ),
    ).toMatchObject({ catalogUrl: 'https://example.test/index.json' });
    expect(
      await call('extensions.catalogSource', () =>
        client.extensions.catalogSource(),
      ),
    ).toMatchObject({
      url: 'https://example.test/index.json',
      origin: 'setting',
    });
    expect(
      await call('extensions.setSafeMode', () =>
        client.extensions.setSafeMode(true),
      ),
    ).toMatchObject({ safeMode: true });
    await expect(
      client.extensions.setSafeMode('yes' as never),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(
      await call('extensions.diagnostics', () =>
        client.extensions.diagnostics(),
      ),
    ).toEqual({
      host: 'running',
      safeMode: { active: true, persisted: true, forcedBy: null },
      extensions: ['acme.user', 'dolphy.sql'].map((id) => ({
        id,
        failures: 0,
        lastFailure: null,
        lastActivationMs: null,
        suppressedUntil: null,
      })),
    });
    await call('extensions.restartHost', () => client.extensions.restartHost());
    expect(
      await call('extensions.readLogs', () =>
        client.extensions.readLogs({ extensionId: 'acme.user', limit: 5 }),
      ),
    ).toEqual([LOG_ENTRY]);
    await expect(
      client.extensions.readLogs({ limit: 501 }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await client.extensions.setSafeMode(false);
    expect(
      await call('extensions.catalog', () =>
        client.extensions.catalog({ refresh: true }),
      ),
    ).toEqual(CATALOG);
    expect(
      await call('extensions.install', () =>
        client.extensions.install('acme.new', '2.0.0'),
      ),
    ).toEqual({
      id: 'acme.new',
      version: '2.0.0',
      previousVersion: null,
    });
    expect(
      await call('extensions.updates', () => client.extensions.updates()),
    ).toEqual([UPDATE]);
    expect(
      await call('extensions.docs', () =>
        client.extensions.docs('acme.new', { version: '2.0.0' }),
      ),
    ).toEqual({
      version: '2.0.0',
      readme: '# New',
      changelog: null,
      truncated: false,
      source: 'catalog',
    });
    expect(
      await call('extensions.docImage', () =>
        client.extensions.docImage('acme.new', '2.0.0', 'docs/a.png'),
      ),
    ).toBe('data:image/png;base64,AA==');
    await expect(
      client.extensions.docImage('acme.new', '2.0.0', 'a.gif'),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await call('extensions.uninstall', () =>
      client.extensions.uninstall('acme.user', { removeData: true }),
    );
    expect(
      await call('extensions.invokeCommand', () =>
        client.extensions.invokeCommand('dolphy.sql', 'dolphy.sql.stats', {
          limit: 3,
        }),
      ),
    ).toEqual({ kind: 'notify', text: '42 rows' });
    await expect(
      client.extensions.invokeCommand('dolphy.sql', 'dolphy.sql.missing'),
    ).rejects.toMatchObject({
      code: 'EXTENSION_COMMAND_FAILED',
      details: { reason: 'unknown-command' },
    });
    expect(
      await call('extensions.invokeRpc', () =>
        client.extensions.invokeRpc({
          extensionId: 'dolphy.sql',
          name: 'greeting.say-hello',
          input: { who: 'Ann' },
        }),
      ),
    ).toEqual({ greeting: { who: 'Ann' } });
    await expect(
      client.extensions.invokeRpc({
        extensionId: 'dolphy.sql',
        name: 'greeting.missing',
        input: undefined,
      }),
    ).rejects.toMatchObject({
      code: 'EXTENSION_RPC_FAILED',
      details: { reason: 'unknown-rpc' },
    });
    // байты проходят структурное копирование туда и обратно
    expect(
      await call('extensions.runExporter', () =>
        client.extensions.runExporter('dolphy.sql', 'dolphy.sql.export', {
          scope: 'progress',
        }),
      ),
    ).toEqual({ filename: 'progress.bin', bytes: new Uint8Array([1, 2, 3]) });
    await expect(
      client.extensions.runExporter('dolphy.sql', 'dolphy.sql.export', {
        scope: 'course',
        courseId: 'x',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      client.extensions.runImporter('dolphy.sql', 'dolphy.sql.import', {
        name: 'a.bin',
        text: 'not bytes',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { reason: 'input-kind' },
    });
    await call('extensions.runImporter', () =>
      expect(
        client.extensions.runImporter('dolphy.sql', 'dolphy.sql.nope', {
          name: 'a.bin',
          bytes: new Uint8Array(2),
        }),
      ).rejects.toMatchObject({
        code: 'EXTENSION_TRANSFER_FAILED',
        details: { kind: 'import', reason: 'unknown-importer' },
      }),
    );
    await call('extensions.commitImport', () =>
      expect(client.extensions.commitImport('missing')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      }),
    );
    expect(
      await call('extensions.discardImport', () =>
        client.extensions.discardImport('missing'),
      ),
    ).toBe(false);
    await expect(
      client.extensions.setEnabled('dolphy.sql', false),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { reason: 'bundled' },
    });
    expect(
      await call('extensions.contributions', () =>
        client.extensions.contributions(),
      ),
    ).toEqual({
      // поколение растёт на каждое применение: включение, безопасный режим (два раза), смена адреса каталога, установка, удаление выше
      generation: 6,
      exerciseTypes: [],
      gradePolicies: [{ id: 'passAtN', extensionId: null, label: null }],
      settings: [ROWS_SETTING],
      commands: [STATS_COMMAND],
      schedules: [SQL_SCHEDULE],
      importers: [IMPORT_BYTES],
      exporters: [EXPORT_PROGRESS],
      clients: [SQL_CLIENT],
    });
    await call('diagnostics', () => client.diagnostics());

    expect([...called].sort()).toEqual(Object.keys(RPC_METHODS).sort());
  });
});
