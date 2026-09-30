import { buildAttempt, buildUnitFlag, createFakeClock } from '@spirula/testkit';
import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../../src/domain/journal.ts';
import { createMemoryEventStore } from '../../src/node/index.ts';
import {
  CLOCK_SKEW_LIMIT_MS,
  MAX_SYNC_BATCH,
  canon,
  createReplica,
  entryHash,
  parseEntry,
  seqInfo,
} from '../../src/sync/index.ts';
import { stateOf } from './oracle.ts';

const NOW_MS = 1_800_000_000_000;

const attempt = (deviceId: string, seq: number, at = NOW_MS - 1_000) =>
  buildAttempt({ deviceId, seq, at, exerciseId: 'c::l::e1' });

const setup = () => {
  const clock = createFakeClock(NOW_MS);
  const store = createMemoryEventStore({ deviceId: 'dev-a' });
  return { clock, store, replica: createReplica({ store, clock }) };
};

const pair = () => {
  const first = buildAttempt({
    id: 'p1',
    deviceId: 'x',
    seq: 1,
    at: NOW_MS - 10,
    exerciseId: 'E1',
  });
  const second = buildAttempt({
    id: 'p2',
    deviceId: 'x',
    seq: 1,
    at: NOW_MS - 9,
    exerciseId: 'E2',
  });
  return { first, second };
};

describe('seqInfo (T-26)', () => {
  it('a contiguous prefix differs from the maximum when files arrive reordered', () => {
    const info = seqInfo([
      { deviceId: 'a', seq: 1 },
      { deviceId: 'a', seq: 2 },
      { deviceId: 'a', seq: 5 },
    ]);
    expect(info.get('a')).toEqual({ max: 5, contiguous: 2, missing: [3, 4] });
  });
});

describe('parseEntry', () => {
  const base = {
    id: 'i',
    deviceId: 'dev-a',
    seq: 1,
    at: 1,
    recordedAt: 1,
    kind: 'attempt',
    exerciseId: 'e',
    grade: 3,
    source: 'self',
  };

  it('strips unknown fields so equal content has one canonical form', () => {
    const parsed = parseEntry({ ...base, future: { field: 1 } });
    expect(parsed.ok && canon(parsed.entry)).toBe(canon(base));
  });

  it.each([
    ['grade 9', { grade: 9 }, 'bad grade'],
    ['grade 3.5', { grade: 3.5 }, 'bad grade'],
    ['source', { source: 'robot' }, 'bad source'],
    ['seq 0', { seq: 0 }, 'bad seq'],
    ['deviceId with slash', { deviceId: 'a/b' }, 'bad deviceId'],
    ['at as string', { at: '1' }, 'bad at/recordedAt'],
    ['kind', { kind: 'nope' }, 'bad kind'],
  ])('rejects %s', (_label, patch, reason) => {
    expect(parseEntry({ ...base, ...patch })).toEqual({ ok: false, reason });
  });

  it('accepts libraryRevision only as a string on progress_reset', () => {
    const reset = {
      id: 'r',
      deviceId: 'dev-a',
      seq: 2,
      at: 1,
      recordedAt: 1,
      kind: 'progress_reset',
      unitId: 'c',
    };
    expect(parseEntry({ ...reset, libraryRevision: 'r1' })).toMatchObject({
      ok: true,
      entry: { libraryRevision: 'r1' },
    });
    expect(parseEntry({ ...reset, libraryRevision: 7 })).toEqual({
      ok: false,
      reason: 'bad libraryRevision',
    });
  });
});

describe('Replica.import / exportSince', () => {
  it('reports structurally invalid entries with reasons and imports the rest', async () => {
    const { replica, store } = setup();
    const good = attempt('b', 1);
    const bad = { ...attempt('b', 2), grade: 9 };
    const result = await replica.import([good, bad, 'junk', null]);
    expect(result).toMatchObject({
      inserted: 1,
      duplicates: 0,
      quarantined: 0,
    });
    expect(result.rejected).toEqual([
      { id: bad.id, reason: 'bad grade' },
      { id: '', reason: 'not an object' },
      { id: '', reason: 'not an object' },
    ]);
    expect(store.entryCount()).toBe(1);
  });

  it('is idempotent and reports duplicates', async () => {
    const { replica } = setup();
    const entries = [attempt('b', 1), attempt('b', 2)];
    await replica.import(entries);
    expect(
      await replica.import([...entries, attempt('b', 3, NOW_MS + 10)]),
    ).toMatchObject({
      inserted: 1,
      duplicates: 2,
      needsRebuild: false,
    });
  });

  it('flags a rebuild when an imported entry is older than what is applied', async () => {
    const { replica, store } = setup();
    await store.append([attempt('dev-a', 1, NOW_MS)]);
    const older = await replica.import([attempt('b', 1, NOW_MS - 50_000)]);
    expect(older.needsRebuild).toBe(true);
    const newer = await replica.import([attempt('b', 2, NOW_MS + 50_000)]);
    expect(newer.needsRebuild).toBe(false);
  });

  it('flags a rebuild when a conflict withdraws a live entry', async () => {
    const { replica } = setup();
    const { first, second } = pair();
    await replica.import([first]);
    const outcome = await replica.import([second]);
    expect(outcome).toMatchObject({
      inserted: 0,
      quarantined: 1,
      needsRebuild: true,
      conflictIds: ['seq-two-ids:x#1'],
    });
  });

  it('refuses more than 5 000 entries per import', async () => {
    const { replica } = setup();
    const entries = Array.from({ length: MAX_SYNC_BATCH + 1 }, (_, i) =>
      attempt('b', i + 1),
    );
    await expect(replica.import(entries)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  it('pages exportSince with a cursor that covers holes and never repeats', async () => {
    const { replica, store } = setup();
    const entries = [1, 2, 3, 5, 6]
      .map((seq) => attempt('b', seq))
      .concat([1, 2].map((seq) => attempt('c', seq)));
    await replica.ingest(entries);
    const seen: string[] = [];
    let since: Record<string, number> | undefined = {};
    for (let pages = 0; since && pages < 10; pages++) {
      const batch = await replica.exportSince({ since, limit: 3 });
      seen.push(...batch.entries.map((e) => `${e.deviceId}${e.seq}`));
      since = batch.next;
    }
    expect(seen).toEqual(['b1', 'b2', 'b3', 'b5', 'b6', 'c1', 'c2']);
    expect(store.vector()).toEqual({ b: 3, c: 2 });
    const rest = await replica.exportSince({ since: store.vector() });
    expect(rest.entries.map((e) => `${e.deviceId}${e.seq}`)).toEqual([
      'b5',
      'b6',
    ]);
    expect(rest.next).toBeUndefined();
  });

  it('rejects a non-positive limit and caps the limit at 5 000', async () => {
    const { replica } = setup();
    await expect(replica.exportSince({ limit: 0 })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    const batch = await replica.exportSince({ limit: 10 * MAX_SYNC_BATCH });
    expect(batch.entries).toEqual([]);
  });

  it('reports state: vector, holes, live count and open conflicts', async () => {
    const { replica } = setup();
    const { first, second } = pair();
    await replica.ingest([attempt('b', 1), attempt('b', 3), first, second]);
    expect(await replica.getState()).toEqual({
      deviceId: 'dev-a',
      vector: { b: 1, x: 1 },
      missing: { b: [2] },
      entryCount: 2,
      conflictCount: 1,
    });
  });
});

describe('clock-skew quarantine (T-59)', () => {
  it('quarantines entries later than recordedAt + 24 h and keeps maxAt healthy', async () => {
    const { replica, store } = setup();
    const ok = buildAttempt({
      deviceId: 'b',
      seq: 1,
      at: NOW_MS + CLOCK_SKEW_LIMIT_MS,
      recordedAt: NOW_MS,
      exerciseId: 'e',
    });
    const skewed = buildAttempt({
      deviceId: 'b',
      seq: 2,
      at: NOW_MS + CLOCK_SKEW_LIMIT_MS + 1,
      recordedAt: NOW_MS,
      exerciseId: 'e',
    });
    const outcome = await replica.ingest([ok, skewed]);
    expect(outcome.inserted).toBe(1);
    expect(outcome.conflictIds).toEqual([`clock-skew:${skewed.id}`]);
    expect(store.maxAt()).toBe(ok.at);
  });

  it('quarantines a device whose own clock runs in 2099 relative to the receiver', async () => {
    const { replica, store } = setup();
    const year2099 = Date.UTC(2099, 0, 1);
    const entries = [1, 2, 3].map((seq) =>
      buildAttempt({
        deviceId: 'far',
        seq,
        at: year2099 + seq,
        recordedAt: year2099 + seq,
        exerciseId: 'e',
      }),
    );
    const outcome = await replica.ingest(entries);
    expect(outcome).toMatchObject({ inserted: 0, quarantined: 3 });
    expect(store.maxAt()).toBe(0);
    const [group] = await replica.listConflicts();
    const restored = await replica.resolveConflict({
      conflictId: group!.conflictId,
      keep: group!.entries[0]!.id,
    });
    expect(restored.restored).toHaveLength(1);
    expect(store.entryCount()).toBe(1);
  });

  it('a healthy write is not lifted above now + 5 min by a quarantined entry', async () => {
    const { replica, store, clock } = setup();
    await replica.ingest([
      buildAttempt({
        deviceId: 'far',
        seq: 1,
        at: Date.UTC(2099, 0, 1),
        recordedAt: Date.UTC(2099, 0, 1),
        exerciseId: 'e',
      }),
    ]);
    expect(store.maxAt() + 1).toBeLessThanOrEqual(clock.now() + 300_000);
  });
});

describe('conflict resolution (T-58)', () => {
  const clash = () => {
    const { first, second } = pair();
    return [first, second] as LogEntry[];
  };

  it('rejects an unknown conflict, an unknown keep and a repeated resolution', async () => {
    const { replica } = setup();
    await replica.ingest(clash());
    await expect(
      replica.resolveConflict({ conflictId: 'nope', keep: 'p1' }),
    ).rejects.toMatchObject({ code: 'SYNC_CONFLICT_NOT_FOUND' });
    await expect(
      replica.resolveConflict({ conflictId: 'seq-two-ids:x#1', keep: 'zzz' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await replica.resolveConflict({
      conflictId: 'seq-two-ids:x#1',
      keep: 'p1',
    });
    await expect(
      replica.resolveConflict({ conflictId: 'seq-two-ids:x#1', keep: 'p1' }),
    ).rejects.toMatchObject({ code: 'SYNC_CONFLICT_NOT_FOUND' });
  });

  it('keep addresses an entry by id or by its hash (id-content shares one id)', async () => {
    const { replica, store } = setup();
    const left = buildAttempt({
      id: 'same',
      deviceId: 'x',
      seq: 1,
      at: 5,
      exerciseId: 'E1',
    });
    const right = buildUnitFlag({
      id: 'same',
      deviceId: 'x',
      seq: 1,
      at: 5,
      unitId: 'E1',
      flag: 'review',
    });
    await replica.ingest([left, right]);
    const result = await replica.resolveConflict({
      conflictId: 'id-content:same',
      keep: entryHash(right),
    });
    expect(result.restored).toEqual([right]);
    expect((await stateOf(store)).live).toEqual([canon(right)]);
  });

  it('keep none discards everything and a later re-import does not reopen it', async () => {
    const { replica, store } = setup();
    await replica.ingest(clash());
    const result = await replica.resolveConflict({
      conflictId: 'seq-two-ids:x#1',
      keep: 'none',
    });
    expect(result).toMatchObject({
      kept: null,
      restored: [],
      needsRebuild: false,
    });
    expect(await replica.listConflicts()).toEqual([]);
    expect(await replica.ingest(clash())).toMatchObject({
      inserted: 0,
      duplicates: 2,
      conflictIds: [],
    });
    expect(store.entryCount()).toBe(0);
  });

  it('is local: two devices resolving differently end with different live sets', async () => {
    const one = setup();
    const two = setup();
    await one.replica.ingest(clash());
    await two.replica.ingest(clash());
    await one.replica.resolveConflict({
      conflictId: 'seq-two-ids:x#1',
      keep: 'p1',
    });
    await two.replica.resolveConflict({
      conflictId: 'seq-two-ids:x#1',
      keep: 'p2',
    });
    expect((await stateOf(one.store)).live).not.toEqual(
      (await stateOf(two.store)).live,
    );
    // повторный обмен решений не выравнивает
    const fromOne = await one.replica.exportSince({});
    await two.replica.ingest([...fromOne.entries]);
    expect((await stateOf(two.store)).live).toEqual([canon(clash()[1]!)]);
  });

  it('a new third entry reopens a group whose survivor was kept', async () => {
    const { replica } = setup();
    await replica.ingest(clash());
    await replica.resolveConflict({
      conflictId: 'seq-two-ids:x#1',
      keep: 'p1',
    });
    const third = buildAttempt({
      id: 'p3',
      deviceId: 'x',
      seq: 1,
      at: NOW_MS - 8,
      exerciseId: 'E3',
    });
    const outcome = await replica.ingest([third]);
    expect(outcome).toMatchObject({
      quarantined: 1,
      needsRebuild: true,
      conflictIds: ['seq-two-ids:x#1'],
    });
    expect(await replica.listConflicts()).toHaveLength(1);
  });
});
