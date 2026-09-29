import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { LogEntryDto } from '@lms/engine-contract';
import { describe, expect, it } from 'vitest';
import { createNodeFolderSyncPort } from '../../../src/node/index.ts';
import type { TraneSource } from '../../../src/sync/index.ts';
import { createTestEngine } from '../../helpers/engine.ts';
import type { TestEngine } from '../../helpers/engine.ts';
import { useTmpDirs } from '../../helpers/tmp.ts';

const EXERCISE = 'embedded::raw_course::lesson::exercise';
const tmp = useTmpDirs();

const attempt = async (device: TestEngine, count = 1) => {
  for (let i = 0; i < count; i++) {
    await device.ctx.commit([
      {
        id: `${device.ctx.eventStore.deviceId}-${device.ctx.eventStore.lastSeq() + 1}`,
        fields: {
          kind: 'attempt',
          exerciseId: EXERCISE,
          grade: 4,
          source: 'self',
        },
      },
    ]);
    device.clock.advance(1000);
  }
};

const exportAll = async (device: TestEngine) =>
  (await device.engine.sync.exportSince()).entries;

const foreignAttempt = (
  id: string,
  seq: number,
  grade: 1 | 2 | 3 | 4 | 5,
  at = 1_800_000_000_000,
): LogEntryDto => ({
  id,
  deviceId: 'device-x',
  seq,
  at,
  recordedAt: at,
  kind: 'attempt',
  exerciseId: EXERCISE,
  grade,
  source: 'self',
});

const pair = async () => {
  const a = await createTestEngine({ deviceId: 'device-a' });
  const b = await createTestEngine({ deviceId: 'device-b' });
  return { a, b };
};

describe('sync exchange', () => {
  it('exports, imports and is idempotent', async () => {
    const { a, b } = await pair();
    await attempt(a, 3);
    const entries = await exportAll(a);
    expect(entries).toHaveLength(3);

    const first = await b.engine.sync.import(entries);
    expect(first).toEqual({
      inserted: 3,
      duplicates: 0,
      rejected: [],
      conflicts: 0,
      rebuilt: false,
    });
    const again = await b.engine.sync.import(entries);
    expect(again).toMatchObject({ inserted: 0, duplicates: 3, rebuilt: false });

    const state = await b.engine.sync.getState();
    expect(state).toMatchObject({
      deviceId: 'device-b',
      vector: { 'device-a': 3 },
      entryCount: 3,
      conflictCount: 0,
    });
    expect(b.events.some((event) => event.type === 'progress')).toBe(true);
  });

  it('pages exports through next', async () => {
    const { a } = await pair();
    await attempt(a, 5);
    const page = await a.engine.sync.exportSince({ limit: 2 });
    expect(page.entries).toHaveLength(2);
    expect(page.next).toEqual({ 'device-a': 2 });
    const rest = await a.engine.sync.exportSince({
      since: page.next!,
      limit: 10,
    });
    expect(rest.entries.map((entry) => entry.seq)).toEqual([3, 4, 5]);
    expect(rest.next).toBeUndefined();
  });

  it('rejects malformed entries with a reason and keeps the rest', async () => {
    const { b } = await pair();
    const good = foreignAttempt('good', 1, 3);
    const result = await b.engine.sync.import([
      good,
      { id: 'bad', kind: 'attempt' } as unknown as LogEntryDto,
    ]);
    expect(result.inserted).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({ id: 'bad' });
    expect(result.rejected[0]!.reason).not.toBe('');
  });

  it('rebuilds when imported entries are older than applied ones', async () => {
    const { a, b } = await pair();
    await attempt(a);
    const old = await exportAll(a);
    b.clock.advance(60_000);
    await attempt(b);
    b.events.length = 0;

    const result = await b.engine.sync.import(old);
    expect(result).toMatchObject({ inserted: 1, rebuilt: true });
    expect(b.events.some((event) => event.type === 'state-rebuilt')).toBe(true);
  });

  it('rebuild reports entries and emits state-rebuilt', async () => {
    const { a } = await pair();
    await attempt(a, 2);
    a.events.length = 0;
    const result = await a.engine.sync.rebuild();
    expect(result.entries).toBe(2);
    expect(result.ms).toBeGreaterThanOrEqual(0);
    expect(a.events).toContainEqual(
      expect.objectContaining({ type: 'state-rebuilt', entries: 2 }),
    );
  });
});

describe('sync conflicts', () => {
  const setup = async () => {
    const { b } = await pair();
    const left = foreignAttempt('same-id', 1, 2);
    const right = foreignAttempt('same-id', 1, 5);
    await b.engine.sync.import([left]);
    b.events.length = 0;
    const result = await b.engine.sync.import([right]);
    return { b, left, right, result };
  };

  it('reports a new id-content conflict and hides both sides', async () => {
    const { b, result } = await setup();
    expect(result).toMatchObject({ inserted: 0, conflicts: 1, rebuilt: true });
    const event = b.events.find((item) => item.type === 'sync-conflict');
    expect(event).toEqual({
      type: 'sync-conflict',
      conflictIds: ['id-content:same-id'],
      unresolved: 1,
    });
    const page = await b.engine.sync.getConflicts();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      conflictId: 'id-content:same-id',
      reason: 'id-content',
    });
    expect(page.items[0]!.entries.map((entry) => entry.id)).toEqual([
      'same-id',
      'same-id',
    ]);
    expect((await b.engine.sync.getState()).conflictCount).toBe(1);
  });

  it('paginates conflicts in a stable order', async () => {
    const { b } = await setup();
    await b.engine.sync.import([
      foreignAttempt('other', 2, 1),
      foreignAttempt('other', 2, 3),
    ]);
    const first = await b.engine.sync.getConflicts({ limit: 1 });
    expect(first.items.map((item) => item.conflictId)).toEqual([
      'id-content:other',
    ]);
    const second = await b.engine.sync.getConflicts({
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(second.items.map((item) => item.conflictId)).toEqual([
      'id-content:same-id',
    ]);
    expect(second.nextCursor).toBeUndefined();
    await expect(
      b.engine.sync.getConflicts({ cursor: '???' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('resolves keeping one side and does not resurrect it on re-import (T-58)', async () => {
    const { b, left, right } = await setup();
    const result = await b.engine.sync.resolveConflict({
      conflictId: 'id-content:same-id',
      keep: 'same-id',
    });
    expect(result).toEqual({
      conflictId: 'id-content:same-id',
      kept: 'same-id',
      rebuilt: true,
    });
    expect((await b.engine.sync.getConflicts()).items).toEqual([]);

    const again = await b.engine.sync.import([left, right]);
    expect(again).toMatchObject({ inserted: 0, conflicts: 0, rebuilt: false });
    expect((await b.engine.sync.getConflicts()).items).toEqual([]);
  });

  it('keep none leaves everything hidden without a rebuild', async () => {
    const { b } = await setup();
    const result = await b.engine.sync.resolveConflict({
      conflictId: 'id-content:same-id',
      keep: 'none',
    });
    expect(result).toEqual({
      conflictId: 'id-content:same-id',
      kept: null,
      rebuilt: false,
    });
    expect((await b.engine.sync.getState()).entryCount).toBe(0);
  });

  it('fails on unknown conflicts and unknown keep', async () => {
    const { b } = await setup();
    await expect(
      b.engine.sync.resolveConflict({
        conflictId: 'id-content:nope',
        keep: 'none',
      }),
    ).rejects.toMatchObject({ code: 'SYNC_CONFLICT_NOT_FOUND' });
    await expect(
      b.engine.sync.resolveConflict({
        conflictId: 'id-content:same-id',
        keep: 'not-a-member',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect((await b.engine.sync.getConflicts()).items).toHaveLength(1);
  });
});

describe('sync.folder', () => {
  const withFolder = async (deviceId: string, root: string, name: string) => {
    const dataDir = join(root, name);
    await mkdir(dataDir);
    return createTestEngine({
      deviceId,
      config: { dataDir },
      folderSync: createNodeFolderSyncPort({ dataDir }),
    });
  };

  it('answers SYNC_FOLDER_NOT_CONFIGURED without a port or a folder', async () => {
    const bare = await createTestEngine();
    await expect(bare.engine.sync.folder.sync()).rejects.toMatchObject({
      code: 'SYNC_FOLDER_NOT_CONFIGURED',
    });
    await expect(
      bare.engine.sync.folder.configure({ dir: '/tmp' }),
    ).rejects.toMatchObject({ code: 'SYNC_FOLDER_NOT_CONFIGURED' });

    const root = await tmp.make();
    const unset = await withFolder('device-a', root, 'a');
    await expect(unset.engine.sync.folder.sync()).rejects.toMatchObject({
      code: 'SYNC_FOLDER_NOT_CONFIGURED',
    });
    await expect(unset.engine.sync.folder.checkRestore()).rejects.toMatchObject(
      {
        code: 'SYNC_FOLDER_NOT_CONFIGURED',
      },
    );
  });

  it('rejects a data directory as the shared folder', async () => {
    const root = await tmp.make();
    const a = await withFolder('device-a', root, 'a');
    await expect(
      a.engine.sync.folder.configure({ dir: join(root, 'a') }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('exchanges entries between two engines through a shared folder', async () => {
    const root = await tmp.make();
    const shared = join(root, 'shared');
    await mkdir(shared);
    const a = await withFolder('device-a', root, 'a');
    const b = await withFolder('device-b', root, 'b');
    expect(await a.engine.sync.folder.configure({ dir: shared })).toEqual({
      dir: shared,
    });
    await b.engine.sync.folder.configure({ dir: shared });

    await attempt(a, 2);
    const published = await a.engine.sync.folder.sync();
    expect(published.published.entries).toBe(2);

    const received = await b.engine.sync.folder.sync();
    expect(received).toMatchObject({
      inserted: 2,
      conflicts: 0,
      rebuilt: false,
    });
    expect(received.applied).toHaveLength(1);
    expect(
      b.events.filter((event) => event.type === 'progress').length,
    ).toBeGreaterThan(0);
    expect((await b.engine.sync.getState()).vector).toEqual({ 'device-a': 2 });

    const repeat = await b.engine.sync.folder.sync();
    expect(repeat).toMatchObject({ inserted: 0, rebuilt: false });

    await attempt(b);
    await b.engine.sync.folder.sync();
    const back = await a.engine.sync.folder.sync();
    expect(back.inserted).toBe(1);
    expect((await a.engine.sync.getState()).entryCount).toBe(3);
    expect(await a.engine.sync.folder.checkRestore()).toEqual({
      action: 'none',
    });
  });

  it('rebuilds when the folder brings older entries', async () => {
    const root = await tmp.make();
    const shared = join(root, 'shared');
    await mkdir(shared);
    const a = await withFolder('device-a', root, 'a');
    const b = await withFolder('device-b', root, 'b');
    await a.engine.sync.folder.configure({ dir: shared });
    await b.engine.sync.folder.configure({ dir: shared });
    await attempt(a);
    await a.engine.sync.folder.sync();
    b.clock.advance(3_600_000);
    await attempt(b);
    b.events.length = 0;
    const report = await b.engine.sync.folder.sync();
    expect(report).toMatchObject({ inserted: 1, rebuilt: true });
    expect(b.events.some((event) => event.type === 'state-rebuilt')).toBe(true);
  });

  it('checkRestore forks a restored device that lost its data', async () => {
    const root = await tmp.make();
    const shared = join(root, 'shared');
    await mkdir(shared);
    const a = await withFolder('device-a', root, 'a');
    await a.engine.sync.folder.configure({ dir: shared });
    await attempt(a, 2);
    await a.engine.sync.folder.sync();

    const restored = await withFolder('device-a', root, 'a-restored');
    await restored.engine.sync.folder.configure({ dir: shared });
    const result = await restored.engine.sync.folder.checkRestore();
    expect(result.action).toBe('catch-up');
  });
});

describe('sync.importFromTrane', () => {
  const source: TraneSource = {
    trials: () => [
      { rowId: 1, unitId: EXERCISE, score: 5, timestampSec: 1_700_000_000 },
      { rowId: 2, unitId: EXERCISE, score: null, timestampSec: 1_700_000_100 },
    ],
    blacklist: () => [EXERCISE],
    reviewList: () => [],
  };

  it('refuses without a Trane reader', async () => {
    const { a } = await pair();
    await expect(
      a.engine.sync.importFromTrane({ traneDir: '/nope' }),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { reason: 'trane-source-unavailable' },
    });
  });

  it('imports once and rebuilds the projections', async () => {
    const opened: string[] = [];
    const a = await createTestEngine({
      openTraneSource: (dir) => {
        opened.push(dir);
        return source;
      },
    });
    const first = await a.engine.sync.importFromTrane({ traneDir: '/trane' });
    expect(first).toEqual({ attempts: 1, flags: 1, skipped: 1 });
    expect(opened).toEqual(['/trane']);
    expect(a.events.some((event) => event.type === 'state-rebuilt')).toBe(true);
    expect((await a.engine.sync.getState()).entryCount).toBe(2);

    a.events.length = 0;
    const second = await a.engine.sync.importFromTrane({ traneDir: '/trane' });
    expect(second).toEqual({ attempts: 0, flags: 0, skipped: 3 });
    expect(a.events).toEqual([]);
  });
});
