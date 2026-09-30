/**
 * Сценарии на всём стеке `@lms/engine` без нативных модулей: настоящие
 * библиотеки-фикстуры, `nodeDefaults` (fs-источник, JSON-настройки), журнал
 * в памяти. Журнал SQLite — `packages/engine-sqlite/test/engine.test.ts`.
 */
import type { EngineConfig, LearningEngine } from '@lms/engine-contract';
import { createFakeClock, createSeededRng, createTestIds } from '@lms/testkit';
import { describe, expect, it } from 'vitest';
import { createEngine } from '../../src/app/index.ts';
import {
  createMemoryEventStore,
  createMemoryRepositoryStore,
  nodeDefaults,
} from '../../src/node/index.ts';
import { GitFetchError } from '../../src/ports/index.ts';
import type { EventStore } from '../../src/ports/index.ts';
import { FIXTURE_LIBRARIES, createTestEngine } from '../helpers/engine.ts';
import { useTmpDirs } from '../helpers/tmp.ts';

const tmp = useTmpDirs();

/** Сессии обучения: батч → оценки по детерминированной формуле → следующий батч. */
const study = async (engine: LearningEngine, rounds: number) => {
  const shown: string[] = [];
  await engine.practice.startSession();
  for (let round = 0; round < rounds; round++) {
    const batch = await engine.practice.getBatch();
    for (const [i, exercise] of batch.exercises.entries()) {
      shown.push(exercise.id);
      await engine.practice.recordAttempt({
        requestId: `r${round}-${i}`,
        exerciseId: exercise.id,
        grade: ((round + i) % 5) + 1 === 1 ? 2 : 4,
      });
    }
  }
  return shown;
};

describe('a study run on the small Trane library', () => {
  it('is deterministic: the same seed and clock give the same batches and scores', async () => {
    const run = async () => {
      const t = await createTestEngine({ library: 'small', seed: 11 });
      const shown = await study(t.engine, 4);
      const progress = await t.engine.practice.getProgress({
        scope: { unitIds: [...new Set(shown)].slice(0, 5) },
      });
      return {
        shown,
        progress: progress.items.map(({ id, score }) => [id, score]),
      };
    };
    const [first, second] = [await run(), await run()];
    expect(first.shown.length).toBeGreaterThan(10);
    expect(first).toEqual(second);
  });

  it('rebuild gives the same scores as the incremental application', async () => {
    const t = await createTestEngine({ library: 'small', seed: 3 });
    const shown = await study(t.engine, 3);
    const units = [...new Set(shown)];
    const scores = async () =>
      (
        await t.engine.practice.getProgress({ scope: { unitIds: units } })
      ).items.map(({ id, score, attempts, status }) => ({
        id,
        score,
        attempts,
        status,
      }));
    const before = await scores();
    const frontier = await t.engine.practice.getFrontier();
    t.events.length = 0;
    const rebuilt = await t.engine.sync.rebuild();
    expect(rebuilt.entries).toBe(t.eventStore.entryCount());
    expect(t.events).toEqual([
      expect.objectContaining({
        type: 'state-rebuilt',
        entries: rebuilt.entries,
      }),
    ]);
    expect(await scores()).toEqual(before);
    expect(await t.engine.practice.getFrontier()).toEqual(frontier);
  });

  it('progress_reset of a course drops it to a clean state on every reading', async () => {
    const t = await createTestEngine({ library: 'small', seed: 5 });
    await study(t.engine, 2);
    const [course] = (await t.engine.library.listCourses()).items;
    t.clock.advance(1_000);
    await t.engine.practice.resetProgress({
      unitId: course!.id,
      requestId: 'reset',
    });
    const { items } = await t.engine.practice.getProgress({
      scope: { courseId: course!.id },
    });
    expect(items.every(({ attempts }) => attempts === 0)).toBe(true);
    expect((await t.engine.practice.getUnitScore(course!.id)).score).toBe(0);
    await t.engine.sync.rebuild();
    expect(
      (
        await t.engine.practice.getProgress({ scope: { courseId: course!.id } })
      ).items.every(({ attempts }) => attempts === 0),
    ).toBe(true);
  });
});

describe('a profile on disk: nodeDefaults over a copied library', () => {
  const open = async (
    config: EngineConfig,
    eventStore: EventStore,
    clock = createFakeClock(),
  ) =>
    createEngine(
      {
        ...nodeDefaults(config),
        clock,
        rng: createSeededRng(1),
        ids: createTestIds('e'),
        eventStore,
        verifiers: [],
        repositoryStore: createMemoryRepositoryStore(),
        snapshotFetcher: {
          resolve: async () => {
            throw new GitFetchError('network', 'offline');
          },
          fetchSnapshot: async () => {
            throw new GitFetchError('network', 'offline');
          },
        },
      },
      config,
    );

  it('persists settings and the artifact across restarts; the journal drives the projections', async () => {
    const libraryRoot = await tmp.copy(FIXTURE_LIBRARIES['sql-course']);
    const dataDir = await tmp.make();
    const config: EngineConfig = { libraryRoot, dataDir };
    const eventStore = createMemoryEventStore();
    const clock = createFakeClock();

    const first = await open(config, eventStore, clock);
    expect(await first.library.getInfo()).toMatchObject({
      state: 'ready',
      artifact: 'fresh',
    });
    await first.curation.filters.save({
      id: 'only-ddl',
      description: 'DDL',
      filter: { LessonFilter: { lesson_ids: ['sql_json::ddl'] } },
    });
    await first.settings.setPreferences({
      ignoredPaths: [],
      schedulerBatchSize: 7,
    });
    await first.practice.recordAttempt({
      requestId: 'a',
      exerciseId: 'sql_json::ddl::q1',
      grade: 5,
    });
    await first.curation.blacklist.add('sql_json::window');

    // рестарт хоста: журнал и файлы те же, память процесса новая
    const second = await open(config, eventStore, clock);
    expect(await second.library.getInfo()).toMatchObject({ artifact: 'fresh' });
    expect(await second.curation.filters.list()).toEqual([
      { id: 'only-ddl', description: 'DDL' },
    ]);
    expect((await second.settings.getScheduler()).batchSize).toBe(7);
    expect(
      (await second.practice.getUnitScore('sql_json::ddl::q1')).score,
    ).toBeGreaterThan(0);
    expect((await second.curation.blacklist.list()).items).toEqual([
      'sql_json::window',
    ]);
    expect(
      (await second.practice.getAttempts('sql_json::ddl::q1')).items,
    ).toHaveLength(1);
    const batch = await second.practice.getBatch({
      filter: {
        UnitFilter: { LessonFilter: { lesson_ids: ['sql_json::ddl'] } },
      },
    });
    expect(batch.exercises.length).toBeGreaterThan(0);
  });

  it('an empty library opens as ready with nothing to practise', async () => {
    const libraryRoot = await tmp.make();
    const dataDir = await tmp.make();
    const engine = await open(
      { libraryRoot, dataDir },
      createMemoryEventStore(),
    );
    const info = await engine.library.getInfo();
    expect(info.counts.courses).toBe(0);
    await expect(engine.practice.getBatch()).resolves.toMatchObject({
      exercises: [],
    });
  });
});
