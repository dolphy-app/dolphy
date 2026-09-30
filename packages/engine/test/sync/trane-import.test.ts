import { createFakeClock } from '@spirula/testkit';
import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../../src/domain/journal.ts';
import { createMemoryEventStore } from '../../src/node/index.ts';
import { importFromTrane } from '../../src/sync/index.ts';
import type { TraneSource, TraneTrial } from '../../src/sync/index.ts';

const NOW_MS = 1_800_000_000_000;

const trial = (
  rowId: number,
  unitId: string,
  score: number | null,
  timestampSec: number | null,
): TraneTrial => ({ rowId, unitId, score, timestampSec });

const source = (
  trials: TraneTrial[],
  blacklist: string[] = [],
  reviewList: string[] = [],
): TraneSource => ({
  trials: () => trials,
  blacklist: () => blacklist,
  reviewList: () => reviewList,
});

const readAll = async (store: ReturnType<typeof createMemoryEventStore>) => {
  const found: LogEntry[] = [];
  for await (const entry of store.readAll()) found.push(entry);
  return found;
};

describe('importFromTrane', () => {
  it('converts seconds to milliseconds and numbers entries without gaps', async () => {
    const store = createMemoryEventStore({ deviceId: 'dev-a' });
    const clock = createFakeClock(NOW_MS);
    const result = await importFromTrane({
      store,
      clock,
      source: source(
        [
          trial(2, 'c::l::e1', 5, 1_700_000_100),
          trial(1, 'c::l::e1', 3, 1_700_000_000),
        ],
        ['c::l::e2'],
        ['c::l'],
      ),
    });
    expect(result).toEqual({ attempts: 2, flags: 2, skipped: 0 });
    const entries = (await readAll(store)).sort((a, b) => a.seq - b.seq);
    expect(entries.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(entries[0]).toMatchObject({
      kind: 'attempt',
      exerciseId: 'c::l::e1',
      grade: 3,
      source: 'trane-import',
      at: 1_700_000_000_000,
      recordedAt: NOW_MS,
    });
    expect(entries[1]).toMatchObject({ grade: 5, at: 1_700_000_100_000 });
    expect(entries[2]).toMatchObject({
      kind: 'unit_flag',
      unitId: 'c::l::e2',
      flag: 'blacklist',
      op: 'set',
    });
    expect(entries[3]).toMatchObject({ unitId: 'c::l', flag: 'review' });
    expect(store.vector()).toEqual({ 'dev-a': 4 });
  });

  it('skips rows without a valid score or time and clamps future timestamps', async () => {
    const store = createMemoryEventStore({ deviceId: 'dev-a' });
    const clock = createFakeClock(NOW_MS);
    const future = NOW_MS / 1000 + 10 * 86_400;
    const result = await importFromTrane({
      store,
      clock,
      source: source([
        trial(1, 'u', null, 1_700_000_000),
        trial(2, 'u', 0, 1_700_000_000),
        trial(3, 'u', 6, 1_700_000_000),
        trial(4, 'u', Number.NaN, 1_700_000_000),
        trial(5, 'u', 4, null),
        trial(6, 'u', 4.2, future),
      ]),
    });
    expect(result).toEqual({ attempts: 1, flags: 0, skipped: 5 });
    const [entry] = await readAll(store);
    expect(entry).toMatchObject({ grade: 4, at: NOW_MS + 300_000 });
  });

  it('is idempotent on one device and leaves no seq gaps when rows are added', async () => {
    const store = createMemoryEventStore({ deviceId: 'dev-a' });
    const clock = createFakeClock(NOW_MS);
    const first = source(
      [trial(1, 'u', 3, 1_000), trial(2, 'u', 4, 2_000)],
      ['b'],
    );
    await importFromTrane({ store, clock, source: first });
    const again = await importFromTrane({ store, clock, source: first });
    expect(again).toEqual({ attempts: 0, flags: 0, skipped: 3 });
    const grown = source(
      [
        trial(1, 'u', 3, 1_000),
        trial(2, 'u', 4, 2_000),
        trial(3, 'u', 5, 3_000),
      ],
      ['b'],
    );
    expect(await importFromTrane({ store, clock, source: grown })).toEqual({
      attempts: 1,
      flags: 0,
      skipped: 3,
    });
    expect(store.entryCount()).toBe(4);
    expect(store.vector()).toEqual({ 'dev-a': 4 });
    expect(store.missing()).toEqual({});
  });

  it('gives two devices importing the same data different ids (no id-content conflicts)', async () => {
    const shared = source([trial(1, 'u', 3, 1_000)]);
    const clock = createFakeClock(NOW_MS);
    const a = createMemoryEventStore({ deviceId: 'dev-a' });
    const b = createMemoryEventStore({ deviceId: 'dev-b' });
    await importFromTrane({ store: a, clock, source: shared });
    await importFromTrane({ store: b, clock, source: shared });
    const [entryA] = await readAll(a);
    const [entryB] = await readAll(b);
    expect(entryA!.id).not.toBe(entryB!.id);
  });
});
