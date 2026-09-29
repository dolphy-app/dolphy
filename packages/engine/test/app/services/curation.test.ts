import type {
  EngineEvent,
  LogEntryDto,
  SavedFilterDto,
  StudySessionWire,
} from '@lms/engine-contract';
import { buildLibrary, buildUnitFlag, T0_MS } from '@lms/testkit';
import { describe, expect, it } from 'vitest';
import {
  createMemoryEventStore,
  createMemorySettingsStore,
} from '../../../src/node/index.ts';
import { createTestEngine } from '../../helpers/engine.ts';

const library = () =>
  buildLibrary({
    courses: [
      {
        id: 'a',
        lessons: [
          { id: 'l0', exercises: 3 },
          { id: 'l1', exercises: 2 },
        ],
      },
      { id: 'b', lessons: [{ id: 'l0', exercises: 2 }] },
    ],
  });

const open = (options: Parameters<typeof createTestEngine>[0] = {}) =>
  createTestEngine({ library: library(), ...options });

const changed = (events: readonly EngineEvent[], scope: string) =>
  events.filter(
    (event) => event.type === 'settings-changed' && event.scope === scope,
  );

const FILTER_A: SavedFilterDto = {
  id: 'only-a',
  description: 'Course a',
  filter: { CourseFilter: { course_ids: ['a'] } },
};

const SESSION: StudySessionWire = {
  id: 'morning',
  description: 'Morning',
  parts: [{ NoFilter: { duration: 15 } }],
};

describe.each([
  ['blacklist', 'blacklist'],
  ['reviewList', 'reviewList'],
] as const)('curation.%s', (name, scope) => {
  const other = name === 'blacklist' ? 'reviewList' : 'blacklist';

  it('add/remove keep list order and are idempotent by state', async () => {
    const { engine, eventStore, events } = await open();
    const service = engine.curation[name];
    await service.add('a::l0::e1');
    await service.add('a::l0::e0');
    await service.add('a::l0::e1');
    expect((await service.list()).items).toEqual(['a::l0::e1', 'a::l0::e0']);
    expect(eventStore.entryCount()).toBe(2);
    expect(changed(events, scope)).toHaveLength(2);
    expect(await service.has('a::l0::e0')).toBe(true);
    expect(await service.has('a::l0::e2')).toBe(false);

    await service.remove('a::l0::e2');
    expect(eventStore.entryCount()).toBe(2);
    await service.remove('a::l0::e1');
    expect(eventStore.entryCount()).toBe(3);
    await service.remove('a::l0::e1');
    expect(eventStore.entryCount()).toBe(3);
    expect((await service.list()).items).toEqual(['a::l0::e0']);
    expect(changed(events, scope)).toHaveLength(3);
  });

  it('flags any unit kind, but not units outside the library', async () => {
    const { engine, eventStore } = await open();
    const service = engine.curation[name];
    await service.add('a');
    await service.add('a::l1');
    await expect(service.add('nope')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(service.remove('nope')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(eventStore.entryCount()).toBe(2);
  });

  it('a flagged unit that left the library can still be removed', async () => {
    const journalEntry = buildUnitFlag({
      unitId: 'gone::l::e',
      flag: name === 'blacklist' ? 'blacklist' : 'review',
    });
    const { engine } = await open({
      eventStore: createMemoryEventStore({ entries: [journalEntry] }),
    });
    const service = engine.curation[name];
    expect(await service.has('gone::l::e')).toBe(true);
    await service.remove('gone::l::e');
    expect(await service.has('gone::l::e')).toBe(false);
  });

  it('list pages by cursor in order of addition', async () => {
    const { engine } = await open();
    const service = engine.curation[name];
    for (const id of ['b::l0::e1', 'a::l0::e0', 'b::l0::e0']) {
      await service.add(id);
    }
    const first = await service.list({ limit: 2 });
    expect(first.items).toEqual(['b::l0::e1', 'a::l0::e0']);
    const second = await service.list({
      limit: 2,
      cursor: first.nextCursor as string,
    });
    expect(second.items).toEqual(['b::l0::e0']);
    await expect(service.list({ limit: 0 })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  it('removePrefix expands the prefix over the current flag state in one transaction', async () => {
    const { engine, eventStore, events } = await open();
    const service = engine.curation[name];
    for (const id of ['a::l0::e0', 'b::l0::e0', 'a::l0::e1', 'a::l1::e0']) {
      await service.add(id);
    }
    await engine.curation[other].add('a::l0::e0');
    const entriesBefore = eventStore.entryCount();
    const eventsBefore = changed(events, scope).length;

    const result = await service.removePrefix('a::l0');
    expect(result).toEqual({ removed: ['a::l0::e0', 'a::l0::e1'] });
    expect(eventStore.entryCount()).toBe(entriesBefore + 2);
    expect(changed(events, scope)).toHaveLength(eventsBefore + 1);
    expect((await service.list()).items).toEqual(['b::l0::e0', 'a::l1::e0']);
    expect(await engine.curation[other].has('a::l0::e0')).toBe(true);

    expect(await service.removePrefix('a::l0')).toEqual({ removed: [] });
    expect(eventStore.entryCount()).toBe(entriesBefore + 2);
    expect(changed(events, scope)).toHaveLength(eventsBefore + 1);
  });

  it('a newer imported record wins, an older one does not (LWW)', async () => {
    const { engine } = await open();
    const service = engine.curation[name];
    const flag = name === 'blacklist' ? 'blacklist' : 'review';
    await service.add('a::l0::e0');

    const older = buildUnitFlag({
      unitId: 'a::l0::e0',
      flag,
      op: 'unset',
      deviceId: 'device-b',
      at: T0_MS - 60_000,
    });
    await engine.sync.import([older as LogEntryDto]);
    expect(await service.has('a::l0::e0')).toBe(true);

    const newer = buildUnitFlag({
      unitId: 'a::l0::e0',
      flag,
      op: 'unset',
      deviceId: 'device-b',
      seq: 2,
      at: T0_MS + 60_000,
    });
    await engine.sync.import([newer as LogEntryDto]);
    expect(await service.has('a::l0::e0')).toBe(false);
  });
});

describe('curation flags and practice', () => {
  it('a blacklisted exercise leaves getBatch and shows as blacklisted in getProgress', async () => {
    const { engine } = await open();
    const idsOf = async () =>
      (await engine.practice.getBatch()).exercises.map(({ id }) => id);
    expect(await idsOf()).toContain('a::l0::e0');

    await engine.curation.blacklist.add('a::l0::e0');
    const batch = await idsOf();
    expect(batch).not.toContain('a::l0::e0');
    expect(batch).toContain('a::l0::e1');
    const progress = await engine.practice.getProgress({
      scope: { lessonId: 'a::l0' },
      includeExercises: true,
    });
    const node = progress.items.find(({ id }) => id === 'a::l0::e0');
    expect(node?.status).toBe('blacklisted');

    await engine.curation.blacklist.remove('a::l0::e0');
    expect(await idsOf()).toContain('a::l0::e0');
  });

  it('a blacklisted course hides all of its exercises', async () => {
    const { engine } = await open();
    await engine.curation.blacklist.add('b');
    const batch = (await engine.practice.getBatch()).exercises;
    expect(batch.length).toBeGreaterThan(0);
    expect(batch.every(({ courseId }) => courseId === 'a')).toBe(true);
  });
});

describe('curation.filters', () => {
  it('saves, lists, gets and deletes', async () => {
    const { engine, ctx, events } = await open();
    expect(await engine.curation.filters.list()).toEqual([]);
    await engine.curation.filters.save(FILTER_A);
    await engine.curation.filters.save({
      id: 'all-b',
      description: 'Course b',
      filter: { CourseFilter: { course_ids: ['b'] } },
    });
    expect(await engine.curation.filters.list()).toEqual([
      { id: 'all-b', description: 'Course b' },
      { id: 'only-a', description: 'Course a' },
    ]);
    expect(await engine.curation.filters.get('only-a')).toEqual(FILTER_A);
    expect(ctx.savedFilters.get('only-a')).toEqual(FILTER_A);
    expect(changed(events, 'filters')).toHaveLength(2);

    await engine.curation.filters.save({ ...FILTER_A, description: 'Updated' });
    expect(await engine.curation.filters.get('only-a')).toMatchObject({
      description: 'Updated',
    });
    expect(ctx.savedFilters.get('only-a')?.description).toBe('Updated');
    expect(await engine.curation.filters.list()).toHaveLength(2);

    await engine.curation.filters.delete('only-a');
    expect(ctx.savedFilters.has('only-a')).toBe(false);
    expect((await engine.curation.filters.list()).map(({ id }) => id)).toEqual([
      'all-b',
    ]);
    expect(changed(events, 'filters')).toHaveLength(4);
  });

  it('get and delete of an unknown filter are NOT_FOUND and send no event', async () => {
    const { engine, events } = await open();
    await expect(engine.curation.filters.get('x')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(engine.curation.filters.delete('x')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(changed(events, 'filters')).toEqual([]);
  });

  it('a structurally invalid filter is INVALID_ARGUMENT and changes nothing', async () => {
    const { engine, ctx, events } = await open();
    const invalid = [
      { ...FILTER_A, filter: { Bogus: { ids: [] } } },
      { ...FILTER_A, id: '' },
      { id: 'no-filter', description: 'x' },
      { ...FILTER_A, filter: { CourseFilter: { course_ids: 'a' } } },
    ];
    for (const filter of invalid) {
      await expect(
        engine.curation.filters.save(filter as unknown as SavedFilterDto),
      ).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        details: { issues: expect.any(Array) },
      });
    }
    expect(await engine.curation.filters.list()).toEqual([]);
    expect(ctx.savedFilters.size).toBe(0);
    expect(changed(events, 'filters')).toEqual([]);
  });

  it('a storage failure leaves the cache and events untouched', async () => {
    const settings = {
      ...createMemorySettingsStore(),
      saveFilter: async () => {
        throw new Error('disk full');
      },
    };
    const { engine, ctx, events } = await open({ settings });
    await expect(engine.curation.filters.save(FILTER_A)).rejects.toMatchObject({
      code: 'INTERNAL',
    });
    expect(ctx.savedFilters.size).toBe(0);
    expect(changed(events, 'filters')).toEqual([]);
  });

  it('a saved filter is visible to the scheduler through a study session', async () => {
    const { engine, clock } = await open();
    await engine.curation.filters.save({
      id: 'only-b',
      description: 'Course b',
      filter: { CourseFilter: { course_ids: ['b'] } },
    });
    const batch = await engine.practice.getBatch({
      filter: {
        StudySession: {
          startTimeMs: clock.now(),
          definition: {
            id: 's',
            parts: [{ SavedFilter: { filter_id: 'only-b', duration: 10 } }],
          },
        },
      },
    });
    expect(batch.exercises.length).toBeGreaterThan(0);
    expect(batch.exercises.every(({ courseId }) => courseId === 'b')).toBe(
      true,
    );
  });

  it('filters saved before opening are loaded into the cache', async () => {
    const settings = createMemorySettingsStore({ filters: [FILTER_A] });
    const { engine, ctx } = await open({ settings });
    expect(ctx.savedFilters.get('only-a')).toEqual(FILTER_A);
    expect(await engine.curation.filters.list()).toHaveLength(1);
  });
});

describe('curation.sessions', () => {
  it('saves, lists, gets and deletes', async () => {
    const { engine, events } = await open();
    await engine.curation.sessions.save(SESSION);
    await engine.curation.sessions.save({ id: 'bare' });
    expect(await engine.curation.sessions.list()).toEqual([
      { id: 'bare', description: '' },
      { id: 'morning', description: 'Morning' },
    ]);
    expect(await engine.curation.sessions.get('morning')).toEqual(SESSION);
    expect(await engine.curation.sessions.get('bare')).toEqual({
      id: 'bare',
      description: '',
      parts: [],
    });
    await engine.curation.sessions.delete('morning');
    expect(await engine.curation.sessions.list()).toEqual([
      { id: 'bare', description: '' },
    ]);
    expect(changed(events, 'sessions')).toHaveLength(3);
  });

  it('NOT_FOUND for unknown sessions and INVALID_ARGUMENT for malformed ones', async () => {
    const { engine, events } = await open();
    await expect(engine.curation.sessions.get('x')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(engine.curation.sessions.delete('x')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const malformed = [
      { id: 's', parts: [{ NoFilter: { duration: -1 } }] },
      { id: 's', parts: [{ Unknown: {} }] },
      { id: '' },
    ];
    for (const session of malformed) {
      await expect(
        engine.curation.sessions.save(session as unknown as StudySessionWire),
      ).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        details: { issues: expect.any(Array) },
      });
    }
    expect(await engine.curation.sessions.list()).toEqual([]);
    expect(changed(events, 'sessions')).toEqual([]);
  });
});
