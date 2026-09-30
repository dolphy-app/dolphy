import {
  buildAttempt,
  buildProgressReset,
  buildUnitFlag,
  createFakeClock,
} from '@spirula-app/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import { EngineError } from '../../src/app/index.ts';
import type { LogEntry } from '../../src/domain/journal.ts';
import type { EventStore } from '../../src/ports/index.ts';
import {
  applyIncoming,
  createReplica,
  groupConflicts,
} from '../../src/sync/index.ts';

/** Одно хранилище под тест; `reopen` — закрыть и открыть тот же файл (нет у memory). */
export interface StoreHarness {
  store: EventStore;
  reopen?: () => Promise<EventStore>;
  dispose: () => Promise<void>;
}

export type HarnessFactory = (deviceId: string) => Promise<StoreHarness>;

const collect = async (store: EventStore): Promise<LogEntry[]> => {
  const found: LogEntry[] = [];
  for await (const entry of store.readAll()) found.push(entry);
  return found;
};

const attempt = (deviceId: string, seq: number, at: number, id?: string) =>
  buildAttempt({
    deviceId,
    seq,
    at,
    exerciseId: 'c::l::e1',
    ...(id !== undefined && { id }),
  });

const merge = (store: EventStore, entries: LogEntry[]) =>
  store.transact((tx) => applyIncoming(tx, entries, { detectedAt: 5 }));

/** Пара из контрпримера спайка: тот же `id`, `(a, 1)`, разное содержимое. */
const CLASH_A = buildAttempt({
  id: 'i2',
  deviceId: 'a',
  seq: 1,
  at: 0,
  exerciseId: 'E1',
  grade: 1,
});
const CLASH_B = buildUnitFlag({
  id: 'i2',
  deviceId: 'a',
  seq: 1,
  at: 0,
  unitId: 'E1',
  flag: 'blacklist',
});

/** Контракт порта `EventStore` (engine-ts-testing.md T-22, T-31, T-58, T-60). */
export const describeEventStoreContract = (
  name: string,
  create: HarnessFactory,
) => {
  describe(`EventStore contract: ${name} (T-31)`, () => {
    const harnesses: StoreHarness[] = [];
    const open = async (deviceId = 'dev-a') => {
      const harness = await create(deviceId);
      harnesses.push(harness);
      return harness;
    };
    afterEach(async () => {
      for (const harness of harnesses.splice(0)) await harness.dispose();
    });

    it('round-trips attempt, unit_flag and progress_reset with libraryRevision', async () => {
      const { store } = await open();
      const entries: LogEntry[] = [
        attempt('dev-a', 1, 1_000),
        buildUnitFlag({
          deviceId: 'dev-a',
          seq: 2,
          at: 1_001,
          unitId: 'c::l',
          flag: 'review',
          op: 'unset',
        }),
        buildProgressReset({
          deviceId: 'dev-a',
          seq: 3,
          at: 1_002,
          unitId: 'c',
          libraryRevision: 'rev-42',
        }),
        buildProgressReset({
          deviceId: 'dev-a',
          seq: 4,
          at: 1_003,
          unitId: 'c',
        }),
      ];
      const result = await store.append(entries);
      expect(result).toEqual({ appended: entries, duplicates: [] });
      expect(await collect(store)).toEqual(entries);
      expect(store.entryCount()).toBe(4);
      expect(store.lastSeq()).toBe(4);
      expect(store.maxAt()).toBe(1_003);
    });

    it('reads in (at, deviceId, seq) order regardless of insertion order (T-03)', async () => {
      const { store } = await open();
      const entries = [
        attempt('b', 1, 10),
        attempt('a', 2, 10),
        attempt('a', 1, 10),
        attempt('c', 1, 5),
        attempt('b', 2, 20),
        attempt('a', 3, 20),
      ];
      await merge(store, [...entries].reverse());
      const order = (await collect(store)).map((e) => `${e.deviceId}${e.seq}`);
      expect(order).toEqual(['c1', 'a1', 'a2', 'b1', 'a3', 'b2']);
    });

    it('append reports known ids as duplicates and never overwrites', async () => {
      const { store } = await open();
      const first = attempt('dev-a', 1, 1_000);
      const second = attempt('dev-a', 2, 1_001);
      await store.append([first, second]);
      const changed = { ...first, grade: 5 } as LogEntry;
      const third = attempt('dev-a', 3, 1_002);
      const result = await store.append([changed, second, third]);
      expect(result.appended).toEqual([third]);
      expect(result.duplicates).toEqual([first.id, second.id]);
      expect((await collect(store))[0]).toEqual(first);
    });

    it('append is atomic: a schema violation stores nothing of the batch', async () => {
      const { store } = await open();
      await store.append([attempt('dev-a', 1, 1_000)]);
      const bad = {
        ...attempt('dev-a', 4, 1_003),
        grade: 9,
      } as unknown as LogEntry;
      await expect(
        store.append([
          attempt('dev-a', 2, 1_001),
          attempt('dev-a', 3, 1_002),
          bad,
        ]),
      ).rejects.toThrow();
      expect(store.entryCount()).toBe(1);
      expect(store.lastSeq()).toBe(1);
      expect(store.maxAt()).toBe(1_000);
    });

    it('append is atomic: (deviceId, seq) is unique even under another id', async () => {
      const { store } = await open();
      await store.append([attempt('dev-a', 1, 1_000)]);
      const clash = attempt('dev-a', 1, 2_000, 'other-id');
      await expect(
        store.append([attempt('dev-a', 2, 1_001), clash]),
      ).rejects.toThrow();
      expect(store.entryCount()).toBe(1);
      expect(store.lastSeq()).toBe(1);
    });

    it('tracks the vector as a contiguous prefix and reports holes', async () => {
      const { store } = await open();
      await merge(store, [
        attempt('a', 1, 1),
        attempt('a', 2, 2),
        attempt('a', 5, 5),
        attempt('b', 2, 3),
      ]);
      expect(store.vector()).toEqual({ a: 2 });
      expect(store.missing()).toEqual({ a: [3, 4], b: [1] });
      expect(store.maxSeq('a')).toBe(5);
      expect(store.maxSeq('nobody')).toBe(0);
      await merge(store, [attempt('a', 3, 3), attempt('a', 4, 4)]);
      expect(store.vector()).toEqual({ a: 5 });
      expect(store.missing()).toEqual({ b: [1] });
    });

    it('lastSeq covers only the own device', async () => {
      const { store } = await open('dev-a');
      await merge(store, [attempt('other', 1, 1), attempt('other', 2, 2)]);
      expect(store.lastSeq()).toBe(0);
      await store.append([attempt('dev-a', 1, 3)]);
      expect(store.lastSeq()).toBe(1);
    });

    it('readSince returns entries above the prefix, behind holes, per device', async () => {
      const { store } = await open();
      await merge(store, [
        attempt('a', 1, 1),
        attempt('a', 2, 2),
        attempt('a', 5, 3),
        attempt('b', 1, 4),
        attempt('b', 2, 5),
      ]);
      const seqs = (entries: readonly LogEntry[]) =>
        entries.map((e) => `${e.deviceId}${e.seq}`);
      expect(seqs(await store.readSince({}, 100))).toEqual([
        'a1',
        'a2',
        'a5',
        'b1',
        'b2',
      ]);
      expect(seqs(await store.readSince({ a: 2, b: 1 }, 100))).toEqual([
        'a5',
        'b2',
      ]);
      expect(seqs(await store.readSince({ a: 5, b: 2 }, 100))).toEqual([]);
      expect(seqs(await store.readSince({}, 3))).toEqual(['a1', 'a2', 'a5']);
    });

    it('readDevice returns a seq range in order', async () => {
      const { store } = await open();
      await merge(store, [
        attempt('a', 3, 3),
        attempt('a', 1, 1),
        attempt('a', 2, 2),
        attempt('b', 1, 4),
      ]);
      const seqs = (entries: readonly LogEntry[]) => entries.map((e) => e.seq);
      expect(seqs(await store.readDevice('a', 1))).toEqual([1, 2, 3]);
      expect(seqs(await store.readDevice('a', 2, 2))).toEqual([2]);
      expect(seqs(await store.readDevice('none', 1))).toEqual([]);
    });

    it('rolls a transaction back on error, including the caches', async () => {
      const { store } = await open();
      await store.append([attempt('dev-a', 1, 1_000)]);
      await expect(
        store.transact((tx) => {
          tx.insert(attempt('dev-a', 2, 9_000));
          tx.insert(attempt('dev-a', 3, 9_001));
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(store.entryCount()).toBe(1);
      expect(store.lastSeq()).toBe(1);
      expect(store.maxAt()).toBe(1_000);
      expect(store.vector()).toEqual({ 'dev-a': 1 });
      await store.append([attempt('dev-a', 2, 1_001)]);
      expect(store.lastSeq()).toBe(2);
    });

    it('hides both sides of id-content and seq-two-ids conflicts from readers (T-22)', async () => {
      const { store } = await open();
      const bystander = attempt('a', 2, 7);
      const outcome = await merge(store, [bystander, CLASH_A, CLASH_B]);
      expect(outcome.quarantined).toBe(1);
      expect(outcome.removed).toEqual([CLASH_A]);
      expect(await collect(store)).toEqual([bystander]);
      const groups = groupConflicts(await store.conflicts());
      expect(groups.map((g) => [g.conflictId, g.reason, g.isOpen])).toEqual([
        ['id-content:i2', 'id-content', true],
      ]);
      expect(groups[0]!.entries).toHaveLength(2);
      expect(store.maxAt()).toBe(7);
      expect(store.vector()).toEqual({ a: 2 });
    });

    it('produces the same conflicts for either arrival order (T-22)', async () => {
      const first = await open();
      const second = await open();
      await merge(first.store, [CLASH_A, CLASH_B]);
      await merge(second.store, [CLASH_B, CLASH_A]);
      expect(await first.store.conflicts()).toEqual(
        await second.store.conflicts(),
      );
      expect(await collect(first.store)).toEqual([]);
      expect(await collect(second.store)).toEqual([]);
    });

    it('quarantines an entry from the future as clock-skew and keeps maxAt healthy', async () => {
      const { store } = await open();
      const day = 86_400_000;
      const healthy = buildAttempt({
        deviceId: 'a',
        seq: 1,
        at: 1_000,
        recordedAt: 1_000,
        exerciseId: 'e',
      });
      const edge = buildAttempt({
        deviceId: 'a',
        seq: 2,
        at: 1_000 + day,
        recordedAt: 1_000,
        exerciseId: 'e',
      });
      const skewed = buildAttempt({
        deviceId: 'a',
        seq: 3,
        at: 1_001 + day,
        recordedAt: 1_000,
        exerciseId: 'e',
      });
      const outcome = await merge(store, [healthy, edge, skewed]);
      expect(outcome.inserted).toEqual([healthy, edge]);
      expect(outcome.conflictIds).toEqual([`clock-skew:${skewed.id}`]);
      expect(store.maxAt()).toBe(1_000 + day);
      expect(store.vector()).toEqual({ a: 3 });
    });

    it('records a local resolution that survives re-import of the same entries', async () => {
      const { store } = await open();
      const clock = createFakeClock();
      const replica = createReplica({ store, clock });
      await merge(store, [CLASH_A, CLASH_B]);
      const keepable = buildAttempt({
        id: 'j1',
        deviceId: 'a',
        seq: 2,
        at: 1,
        exerciseId: 'E1',
      });
      const twin = buildAttempt({
        id: 'j2',
        deviceId: 'a',
        seq: 2,
        at: 2,
        exerciseId: 'E2',
      });
      await merge(store, [keepable, twin]);
      const result = await replica.resolveConflict({
        conflictId: 'seq-two-ids:a#2',
        keep: 'j1',
      });
      expect(result).toMatchObject({ kept: 'j1', needsRebuild: true });
      expect(await collect(store)).toEqual([keepable]);
      expect(await replica.listConflicts()).toHaveLength(1); // id-content:i2 still open
      const again = await merge(store, [keepable, twin]);
      expect(again.duplicates).toBe(2);
      expect(again.conflictIds).toEqual([]);
      expect(await collect(store)).toEqual([keepable]);
    });

    it('registers applied segments', async () => {
      const { store } = await open();
      const segment = {
        deviceId: 'a',
        name: 'seg-1-2.jsonl',
        sha256: 'ab'.repeat(32),
        firstSeq: 1,
        lastSeq: 2,
        importedAt: 77,
      };
      await store.transact((tx) => {
        tx.putSegment(segment);
        tx.putSegment(segment);
      });
      expect(await store.segments()).toEqual([segment]);
    });

    it('rotates the device id and restarts own numbering', async () => {
      const { store } = await open('dev-a');
      await store.append([attempt('dev-a', 1, 1), attempt('dev-a', 2, 2)]);
      await store.rotateDeviceId('dev-a-2');
      expect(store.deviceId).toBe('dev-a-2');
      expect(store.lastSeq()).toBe(0);
      await store.append([attempt('dev-a-2', 1, 3)]);
      expect(store.lastSeq()).toBe(1);
      expect(store.entryCount()).toBe(3);
      await expect(store.rotateDeviceId('bad id!')).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
    });

    it('rejects everything after close with ENGINE_CLOSED and closes twice', async () => {
      const { store } = await open();
      await store.close();
      await store.close();
      const failure = await store
        .append([attempt('dev-a', 1, 1)])
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(EngineError);
      expect(failure).toMatchObject({ code: 'ENGINE_CLOSED' });
    });

    it('keeps entries, conflicts with their state, segments and device id across reopen', async () => {
      const harness = await open('dev-a');
      if (!harness.reopen) return;
      const { store } = harness;
      const own = [attempt('dev-a', 1, 1_000), attempt('dev-a', 2, 1_001)];
      await store.append(own);
      await merge(store, [CLASH_A, CLASH_B]);
      const replica = createReplica({ store, clock: createFakeClock() });
      await store.transact((tx) =>
        tx.putSegment({
          deviceId: 'a',
          name: 'seg-1-1.jsonl',
          sha256: 'cd'.repeat(32),
          firstSeq: 1,
          lastSeq: 1,
          importedAt: 9,
        }),
      );
      await replica.resolveConflict({
        conflictId: 'id-content:i2',
        keep: 'none',
      });
      const before = {
        conflicts: await store.conflicts(),
        segments: await store.segments(),
        vector: store.vector(),
        maxAt: store.maxAt(),
      };

      const reopened = await harness.reopen();
      harness.store = reopened;
      expect(reopened.deviceId).toBe('dev-a');
      expect(await collect(reopened)).toEqual(own);
      expect(await reopened.conflicts()).toEqual(before.conflicts);
      expect((await reopened.conflicts()).map((row) => row.state)).toEqual([
        'discarded',
        'discarded',
      ]);
      expect(await reopened.segments()).toEqual(before.segments);
      expect(reopened.vector()).toEqual(before.vector);
      expect(reopened.maxAt()).toBe(before.maxAt);
      expect(reopened.lastSeq()).toBe(2);
      const again = await merge(reopened, [CLASH_A, CLASH_B]);
      expect(again).toMatchObject({ duplicates: 2, conflictIds: [] });
    });
  });
};
