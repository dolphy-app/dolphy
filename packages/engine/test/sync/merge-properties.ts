import { createFakeClock } from '@spirula/testkit';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Grade } from '@spirula/engine-contract';
import type { EntryFields } from '../../src/app/index.ts';
import type { LogEntry } from '../../src/domain/journal.ts';
import type { EventStore } from '../../src/ports/index.ts';
import { applyIncoming, canon, compareEntries } from '../../src/sync/index.ts';
import { createDevice } from './devices.ts';
import type { Device, StoreFactory } from './devices.ts';
import { oracleState, setOf, stateOf } from './oracle.ts';

export const SEED = 20_260_929;
const DAY_MS = 86_400_000;

export interface MergeSubject {
  name: string;
  /** Пустое хранилище; `dispose` вызывается после проверки. */
  create: () => Promise<{ store: EventStore; dispose: () => Promise<void> }>;
  numRuns: number;
}

const DEVICES = ['a', 'b', 'c'] as const;
const EXERCISES = ['E1', 'E2', 'E3', 'E4'] as const;
const UNITS = ['C', 'L1', 'L2', 'E1', 'E2', 'E3', 'E4'] as const;

/** «Дикие» записи: крошечные алфавиты `id` и `(deviceId, seq)` — конфликты часты. */
const wildEntry: fc.Arbitrary<LogEntry> = fc.oneof(
  fc.record({
    id: fc.constantFrom('i1', 'i2', 'i3', 'i4'),
    deviceId: fc.constantFrom('a', 'b'),
    seq: fc.integer({ min: 1, max: 3 }),
    at: fc.integer({ min: 0, max: 3 }),
    recordedAt: fc.constant(0),
    kind: fc.constant('attempt' as const),
    exerciseId: fc.constantFrom('E1', 'E2'),
    grade: fc.constantFrom<Grade>(1, 3, 5),
    source: fc.constant('self' as const),
  }),
  fc.record({
    id: fc.constantFrom('i1', 'i2', 'i3', 'i4'),
    deviceId: fc.constantFrom('a', 'b'),
    seq: fc.integer({ min: 1, max: 3 }),
    at: fc.integer({ min: 0, max: 3 }),
    recordedAt: fc.constant(0),
    kind: fc.constant('unit_flag' as const),
    unitId: fc.constantFrom('E1', 'L1'),
    flag: fc.constantFrom('blacklist' as const, 'review' as const),
    op: fc.constantFrom('set' as const, 'unset' as const),
  }),
  // граница 24 ч: ровно +24 ч не карантин, +24 ч + 1 мс — карантин
  fc.record({
    id: fc.constantFrom('i1', 'i2', 'i3'),
    deviceId: fc.constantFrom('a', 'b'),
    seq: fc.integer({ min: 1, max: 3 }),
    at: fc.constantFrom(DAY_MS - 1, DAY_MS, DAY_MS + 1, 0),
    recordedAt: fc.constant(0),
    kind: fc.constant('progress_reset' as const),
    unitId: fc.constantFrom('C', 'L1'),
  }),
);

export const wildLog = fc.array(wildEntry, { maxLength: 8 });

interface Op {
  dev: (typeof DEVICES)[number];
  kind: 'attempt' | 'flag' | 'reset';
  unit: string;
  at: number;
  grade: Grade;
  on: boolean;
}

const op: fc.Arbitrary<Op> = fc.record({
  dev: fc.constantFrom(...DEVICES),
  kind: fc.constantFrom('attempt', 'attempt', 'attempt', 'flag', 'reset'),
  unit: fc.constantFrom(...UNITS),
  at: fc.integer({ min: 0, max: 25 }), // узкий диапазон: много ничьих
  grade: fc.constantFrom<Grade>(1, 2, 3, 4, 5),
  on: fc.boolean(),
});

/** Корректная «вселенная»: `seq` по устройствам без дыр, `id` уникальны. */
const universeFrom = (ops: Op[]): LogEntry[] => {
  const seqs: Record<string, number> = {};
  return ops.map((item, index): LogEntry => {
    const seq = (seqs[item.dev] = (seqs[item.dev] ?? 0) + 1);
    const base = {
      id: `${item.dev}${seq}`,
      deviceId: item.dev,
      seq,
      at: item.at,
      recordedAt: item.at + index,
    };
    if (item.kind === 'attempt') {
      const exerciseId = EXERCISES[index % EXERCISES.length]!;
      return {
        ...base,
        kind: 'attempt',
        exerciseId,
        grade: item.grade,
        source: 'self',
      };
    }
    if (item.kind === 'flag') {
      const op = item.on ? 'set' : 'unset';
      return {
        ...base,
        kind: 'unit_flag',
        unitId: item.unit,
        flag: 'blacklist',
        op,
      };
    }
    return { ...base, kind: 'progress_reset', unitId: item.unit };
  });
};

const universe = fc.array(op, { maxLength: 30 }).map(universeFrom);

const sampled = <T>(items: T[], picks: number[]): T[] =>
  items.length === 0 ? [] : picks.map((pick) => items[pick % items.length]!);

export const describeMergeProperties = ({
  name,
  create,
  numRuns,
}: MergeSubject) => {
  const params = { seed: SEED, numRuns };
  const timeout = 10_000 + numRuns * 25;

  /** Свежая реплика; результат снимается до `dispose`. */
  const withStore = async <T>(
    work: (store: EventStore) => Promise<T>,
  ): Promise<T> => {
    const { store, dispose } = await create();
    try {
      return await work(store);
    } finally {
      await dispose();
    }
  };

  const feed = (store: EventStore, entries: LogEntry[]) =>
    store.transact((tx) => applyIncoming(tx, entries, { detectedAt: 1 }));

  /** merge(X, Y) — слияние состояний-множеств двух реплик. */
  const mergeSets = (...sets: LogEntry[][]) =>
    withStore(async (store) => {
      for (const set of sets) await feed(store, set);
      return { state: await stateOf(store), all: await setOf(store) };
    });

  const replica = (entries: LogEntry[]) => mergeSets(entries);

  describe(`merge algebra (${name}, ${numRuns} runs)`, { timeout }, () => {
    it('state equals the oracle for any order, chunking and duplicates (T-21)', async () => {
      await fc.assert(
        fc.asyncProperty(
          wildLog,
          fc.array(fc.nat(), { maxLength: 12 }),
          fc.integer({ min: 1, max: 4 }),
          async (log, picks, chunk) => {
            const stream = [...log, ...sampled(log, picks)].reverse();
            const state = await withStore(async (store) => {
              for (let i = 0; i < stream.length; i += chunk) {
                await feed(store, stream.slice(i, i + chunk));
              }
              return stateOf(store);
            });
            expect(state).toEqual(oracleState(log));
          },
        ),
        params,
      );
    });

    it('merge is commutative for live entries and conflicts (T-08, T-21)', async () => {
      await fc.assert(
        fc.asyncProperty(wildLog, wildLog, async (a, b) => {
          const ab = await mergeSets(a, b);
          const ba = await mergeSets(b, a);
          expect(ab.state).toEqual(ba.state);
        }),
        params,
      );
    });

    it('merge is associative over replica sets (T-08, T-21)', async () => {
      await fc.assert(
        fc.asyncProperty(wildLog, wildLog, wildLog, async (a, b, c) => {
          const ab = await mergeSets(a, b);
          const bc = await mergeSets(b, c);
          const left = await mergeSets(ab.all, c);
          const right = await mergeSets(a, bc.all);
          expect(left.state).toEqual(right.state);
          expect(left.state).toEqual(oracleState([...a, ...b, ...c]));
        }),
        params,
      );
    });

    it('merge is idempotent (T-08, T-21)', async () => {
      await fc.assert(
        fc.asyncProperty(wildLog, wildLog, async (a, b) => {
          const once = await replica(a);
          const twice = await mergeSets(once.all, once.all);
          expect(twice.state).toEqual(once.state);
          const ab = await mergeSets(a, b);
          const abab = await mergeSets(a, ab.all, b);
          expect(abab.state).toEqual(ab.state);
        }),
        params,
      );
    });

    it('a well-formed universe merges without conflicts in any partial exchange', async () => {
      await fc.assert(
        fc.asyncProperty(
          universe,
          fc.array(fc.boolean(), { maxLength: 30 }),
          async (log, mask) => {
            const left = log.filter((_, i) => mask[i] ?? false);
            const right = log.filter((_, i) => !(mask[i] ?? false));
            const merged = await mergeSets(left, right);
            expect(merged.state.conflicts).toEqual([]);
            expect(merged.state).toEqual(oracleState(log));
          },
        ),
        params,
      );
    });

    it('the order key is antisymmetric and transitive (T-21)', () => {
      fc.assert(
        fc.property(wildEntry, wildEntry, wildEntry, (x, y, z) => {
          expect(Math.sign(compareEntries(x, y))).toBe(
            -Math.sign(compareEntries(y, x)) || 0,
          );
          const ordered = [x, y, z].sort(compareEntries);
          expect(compareEntries(ordered[0]!, ordered[1]!)).toBeLessThanOrEqual(
            0,
          );
          expect(compareEntries(ordered[1]!, ordered[2]!)).toBeLessThanOrEqual(
            0,
          );
          expect(compareEntries(ordered[0]!, ordered[2]!)).toBeLessThanOrEqual(
            0,
          );
        }),
        params,
      );
    });
  });

  describe(`merge regressions (${name})`, () => {
    const attemptEntry = (): LogEntry => ({
      kind: 'attempt',
      id: 'i2',
      deviceId: 'a',
      seq: 1,
      at: 0,
      recordedAt: 0,
      exerciseId: 'E1',
      grade: 1,
      source: 'self',
    });
    const flagEntry = (): LogEntry => ({
      kind: 'unit_flag',
      id: 'i2',
      deviceId: 'a',
      seq: 1,
      at: 0,
      recordedAt: 0,
      unitId: 'E1',
      flag: 'blacklist',
      op: 'set',
    });

    /** Правило «по id, побеждает первая, конфликтующую входящую отклонить». */
    const mergeFirstWins = (a: LogEntry[], b: LogEntry[]): string[] => {
      const byId = new Map<string, LogEntry>();
      for (const entry of [...a, ...b]) {
        if (!byId.has(entry.id)) byId.set(entry.id, entry);
      }
      return [...byId.values()].map((entry) => canon(entry));
    };

    it('first-wins is order dependent (spike counterexample) while set merge is not (T-22)', async () => {
      const a = [attemptEntry()];
      const b = [flagEntry()];
      expect(mergeFirstWins(a, b)).not.toEqual(mergeFirstWins(b, a));

      const ab = await mergeSets(a, b);
      const ba = await mergeSets(b, a);
      expect(ab.state).toEqual(ba.state);
      expect(ab.state.live).toEqual([]);
      expect(ab.state.conflicts).toHaveLength(1);
      expect(ab.state.conflicts[0]!.members).toHaveLength(2);
    });

    it('a conflict that arrives later withdraws an already live entry', async () => {
      await withStore(async (store) => {
        await feed(store, [attemptEntry()]);
        expect((await stateOf(store)).live).toHaveLength(1);
        const outcome = await feed(store, [flagEntry()]);
        expect(outcome.removed).toHaveLength(1);
        expect((await stateOf(store)).live).toEqual([]);
      });
    });
  });

  describe(`HLC and merge agree (${name})`, { timeout }, () => {
    const factory: StoreFactory = async (deviceId) => {
      const { store } = await create();
      await store.rotateDeviceId(deviceId);
      return store;
    };

    const fieldsFor = (kind: 'attempt' | 'flag' | 'reset'): EntryFields => {
      if (kind === 'attempt') {
        return {
          kind: 'attempt',
          exerciseId: 'E1',
          grade: 3,
          source: 'self',
        };
      }
      if (kind === 'flag') {
        return {
          kind: 'unit_flag',
          unitId: 'E1',
          flag: 'blacklist',
          op: 'set',
        };
      }
      return { kind: 'progress_reset', unitId: 'E1' };
    };

    const pull = async (from: Device, to: Device) => {
      const { entries } = await from.replica.exportSince({
        since: to.store.vector(),
      });
      await feed(to.store, [...entries]);
    };

    const kinds = ['attempt', 'flag', 'reset'] as const;
    const stepArb = fc.record({
      dev: fc.constantFrom(...DEVICES),
      act: fc.constantFrom('write', 'write', 'write', 'pull', 'tick'),
      peer: fc.constantFrom(...DEVICES),
      tickMs: fc.integer({ min: -600_000, max: 600_000 }),
      kind: fc.constantFrom(...kinds),
    });
    const skewArb = fc.integer({ min: -36_000_000, max: 36_000_000 });

    it('writes after import sort after everything seen; replicas converge to the oracle', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(stepArb, { minLength: 1, maxLength: 25 }),
          fc.tuple(skewArb, skewArb, skewArb),
          async (steps, skews) => {
            const devices = new Map<string, Device>();
            for (const [index, dev] of DEVICES.entries()) {
              const clock = createFakeClock();
              clock.advance(skews[index]!);
              devices.set(dev, await createDevice(factory, dev, { clock }));
            }
            const lastOwnAt = new Map<string, number>();
            const written: LogEntry[] = [];
            try {
              for (const step of steps) {
                const device = devices.get(step.dev)!;
                if (step.act === 'tick') {
                  device.clock.advance(step.tickMs);
                } else if (step.act === 'pull') {
                  await pull(devices.get(step.peer)!, device);
                } else {
                  const seenBefore = device.store.maxAt();
                  const entry = await device.write(fieldsFor(step.kind));
                  expect(entry.at).toBeGreaterThan(seenBefore);
                  expect(entry.at).toBeGreaterThanOrEqual(
                    lastOwnAt.get(step.dev) ?? 0,
                  );
                  lastOwnAt.set(step.dev, entry.at);
                  written.push(entry);
                }
              }
              for (let round = 0; round < 2; round++) {
                for (const from of devices.values()) {
                  for (const to of devices.values()) {
                    if (from !== to) await pull(from, to);
                  }
                }
              }
              const states = [];
              for (const device of devices.values()) {
                states.push(await stateOf(device.store));
              }
              expect(states[1]).toEqual(states[0]);
              expect(states[2]).toEqual(states[0]);
              expect(states[0]).toEqual(oracleState(written));
              expect(states[0]!.conflicts).toEqual([]);
            } finally {
              for (const device of devices.values()) await device.store.close();
            }
          },
        ),
        { seed: SEED, numRuns: Math.max(20, Math.floor(numRuns / 6)) },
      );
    });

    it('a reset and unset written after import outrank imported entries at ±1 day of skew (T-23)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: -DAY_MS, max: DAY_MS }),
          fc.integer({ min: 0, max: 120_000 }),
          async (skewMs, gapMs) => {
            const clockB = createFakeClock();
            clockB.advance(skewMs);
            const a = await createDevice(factory, 'a');
            const b = await createDevice(factory, 'b', { clock: clockB });
            try {
              const imported = [
                await b.write(fieldsFor('attempt')),
                await b.write(fieldsFor('flag')),
              ];
              await pull(b, a);
              a.clock.advance(gapMs);
              const reset = await a.write(fieldsFor('reset'));
              const unset = await a.write({
                kind: 'unit_flag',
                unitId: 'E1',
                flag: 'blacklist',
                op: 'unset',
              });
              for (const entry of imported) {
                expect(compareEntries(reset, entry)).toBeGreaterThan(0);
                expect(compareEntries(unset, entry)).toBeGreaterThan(0);
              }
            } finally {
              await a.store.close();
              await b.store.close();
            }
          },
        ),
        { seed: SEED, numRuns: Math.max(20, Math.floor(numRuns / 6)) },
      );
    });
  });
};
