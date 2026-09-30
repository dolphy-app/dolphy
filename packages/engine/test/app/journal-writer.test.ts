import type { EpochMs } from '@spirula/engine-contract';
import { createFakeClock, createTestIds } from '@spirula/testkit';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../../src/domain/journal.ts';
import { FIVE_MIN_MS, createJournalWriter } from '../../src/app/index.ts';

const createStore = (foreignMaxAt: EpochMs = 0) => {
  let seq = 0;
  let maxAt = foreignMaxAt;
  return {
    deviceId: 'device-a',
    lastSeq: () => seq,
    maxAt: () => maxAt,
    /** Как `append`: кэши обновляются после записи. */
    record: (entry: LogEntry) => {
      seq = entry.seq;
      maxAt = Math.max(maxAt, entry.at);
    },
  };
};

type Step =
  | { op: 'tick'; ms: number } // часы идут вперёд или назад
  | { op: 'write'; requestedOffset: number | null }
  | { op: 'foreign'; at: number }; // импорт записи с другого устройства

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    op: fc.constant('tick' as const),
    ms: fc.integer({ min: -86_400_000, max: 86_400_000 }),
  }),
  fc.record({
    op: fc.constant('write' as const),
    requestedOffset: fc.option(
      fc.integer({ min: -86_400_000, max: 86_400_000 }),
      { nil: null },
    ),
  }),
  fc.record({
    op: fc.constant('foreign' as const),
    at: fc.integer({ min: 0, max: 1_900_000_000_000 }),
  }),
);

describe('createJournalWriter', () => {
  it('HLC invariants hold under clock skew, steps back and foreign entries', () => {
    fc.assert(
      fc.property(
        fc.array(stepArb, { minLength: 1, maxLength: 60 }),
        (steps) => {
          const clock = createFakeClock();
          const store = createStore();
          const writer = createJournalWriter({
            clock,
            ids: createTestIds(),
            eventStore: store,
          });
          let prevAt = 0;
          let expectedSeq = 0;
          for (const step of steps) {
            if (step.op === 'tick') {
              clock.advance(step.ms);
            } else if (step.op === 'foreign') {
              store.record({
                kind: 'attempt',
                id: `f-${step.at}`,
                deviceId: 'device-b',
                seq: store.lastSeq(), // чужой seq не двигает наш
                at: step.at,
                recordedAt: step.at,
                exerciseId: 'c::l::e',
                grade: 3,
                source: 'self',
              });
            } else {
              const now = clock.now();
              const seenMaxAt = store.maxAt();
              const requested =
                step.requestedOffset === null
                  ? undefined
                  : now + step.requestedOffset;
              const entry = writer.build(
                {
                  kind: 'attempt',
                  exerciseId: 'c::l::e',
                  grade: 3,
                  source: 'self',
                },
                requested === undefined ? {} : { at: requested },
              );
              const clamped = Math.min(requested ?? now, now + FIVE_MIN_MS);
              // не меньше уже увиденного и не меньше своего прошлого at
              expect(entry.at).toBeGreaterThan(seenMaxAt);
              expect(entry.at).toBeGreaterThanOrEqual(prevAt);
              // сверх зажима now + 5 мин поднимают только увиденное и своё прошлое
              expect(entry.at).toBeLessThanOrEqual(
                Math.max(clamped, seenMaxAt + 1, prevAt),
              );
              expect(entry.at).toBeGreaterThanOrEqual(clamped);
              expectedSeq += 1;
              expect(entry.seq).toBe(expectedSeq); // без пропусков
              store.record(entry);
              writer.commit(entry);
              prevAt = entry.at;
            }
          }
        },
      ),
      { seed: 20260929, numRuns: 300 },
    );
  });

  it('seq grows only after commit: a failed append leaves no gap', () => {
    const clock = createFakeClock();
    const store = createStore();
    const writer = createJournalWriter({
      clock,
      ids: createTestIds(),
      eventStore: store,
    });
    const fields = {
      kind: 'attempt',
      exerciseId: 'c::l::e',
      grade: 3,
      source: 'self',
    } as const;
    const first = writer.build(fields);
    const retry = writer.build(fields); // append первой не удался, commit не вызывали
    expect(first.seq).toBe(1);
    expect(retry.seq).toBe(1);
    store.record(retry);
    writer.commit(retry);
    expect(writer.build(fields).seq).toBe(2);
  });

  it('continues seq from the store and uses requestId as id', () => {
    const store = createStore();
    store.record({
      kind: 'attempt',
      id: 'old',
      deviceId: 'device-a',
      seq: 41,
      at: 5,
      recordedAt: 5,
      exerciseId: 'c::l::e',
      grade: 3,
      source: 'self',
    });
    const writer = createJournalWriter({
      clock: createFakeClock(),
      ids: createTestIds(),
      eventStore: store,
    });
    const entry = writer.build(
      { kind: 'unit_flag', unitId: 'c', flag: 'blacklist', op: 'set' },
      { id: 'req-1' },
    );
    expect(entry).toMatchObject({ id: 'req-1', seq: 42, deviceId: 'device-a' });
    expect(entry.recordedAt).toBe(createFakeClock().now());
  });
});
