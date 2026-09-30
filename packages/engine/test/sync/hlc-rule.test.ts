/**
 * T-23: правило HLC для `at` — `max(min(now, now + 5 мин), maxAtУвиденный + 1,
 * свойПрошлыйAt)`. (а) перекос часов ±1 сутки: сброс и `unset`, записанные
 * после импорта, покрывают импортированные попытку и флаг; (б) шаг часов на
 * 10 мин назад: новая попытка после собственного сброса остаётся живой; (в)
 * зажим `now + 5 мин`; (г) мутант «`at` = стенные часы» валит (а) и (б): попытка
 * переживает сброс ⇔ перекос ≥ 60 000 мс. Оракул — проекции над журналом.
 */
import {
  createFakeClock,
  createTestIds,
  generateLibrary,
} from '@spirula-app/testkit';
import type { FakeClock } from '@spirula-app/testkit';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { EntryFields } from '../../src/app/index.ts';
import { FIVE_MIN_MS, createJournalWriter } from '../../src/app/index.ts';
import type { LogEntry } from '../../src/domain/journal.ts';
import { createMemoryEventStore } from '../../src/node/index.ts';
import type { EventStore } from '../../src/ports/index.ts';
import { applyIncoming } from '../../src/sync/index.ts';
import { createTestProjections, toLibrary } from '../state/helpers.ts';

const SEED = 20_260_929;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const library = toLibrary(
  generateLibrary({
    courses: 1,
    lessonsPerCourse: 2,
    exercisesPerLesson: 2,
    seed: 7,
  }),
);
const [EXERCISE] = library.getAllExerciseIds() as [string];

/** `hlc` — продукция; `wall` — мутант из спайка: `at` = показание часов. */
type Policy = 'hlc' | 'wall';

interface Device {
  readonly store: EventStore;
  readonly clock: FakeClock;
  write(fields: EntryFields, at?: number): Promise<LogEntry>;
}

const createDevice = (
  policy: Policy,
  deviceId: string,
  clock: FakeClock,
): Device => {
  const store = createMemoryEventStore({ deviceId });
  const writer = createJournalWriter({
    clock,
    ids: createTestIds(deviceId),
    eventStore: store,
  });
  return {
    store,
    clock,
    write: async (fields, at) => {
      const built = writer.build(fields, at === undefined ? {} : { at });
      const entry =
        policy === 'hlc'
          ? built
          : ({ ...built, at: at ?? clock.now() } as LogEntry);
      await store.append([entry]);
      writer.commit(entry);
      return entry;
    },
  };
};

const attempt: EntryFields = {
  kind: 'attempt',
  exerciseId: EXERCISE,
  grade: 3,
  source: 'self',
};
const flag = (op: 'set' | 'unset'): EntryFields => ({
  kind: 'unit_flag',
  unitId: EXERCISE,
  flag: 'blacklist',
  op,
});
const reset: EntryFields = { kind: 'progress_reset', unitId: EXERCISE };

const importInto = (to: Device, entries: readonly LogEntry[]) =>
  to.store.transact((tx) => applyIncoming(tx, entries, { detectedAt: 1 }));

const readAll = async (store: EventStore) => {
  const entries: LogEntry[] = [];
  for await (const entry of store.readAll()) entries.push(entry);
  return entries;
};

/** Проекции, перестроенные из журнала устройства. */
const rebuildFrom = async (device: Device) => {
  const { projections } = createTestProjections(library);
  await projections.rebuildFrom(device.store.readAll());
  return {
    attempts: projections.attempts.count(EXERCISE),
    blacklisted: projections.flags.has('blacklist', EXERCISE),
  };
};

/** (а): B с часами, сдвинутыми на `skewMs`, пишет попытку и флаг; A импортирует и через минуту сбрасывает. */
const skewScenario = async (policy: Policy, skewMs: number) => {
  const a = createDevice(policy, 'a', createFakeClock());
  const clockB = createFakeClock();
  clockB.advance(skewMs);
  const b = createDevice(policy, 'b', clockB);
  await b.write(attempt);
  await b.write(flag('set'));
  await importInto(a, await readAll(b.store));
  a.clock.advance(MINUTE_MS);
  await a.write(reset);
  await a.write(flag('unset'));
  return rebuildFrom(a);
};

/** (б): собственная попытка, собственный сброс, часы назад на `backMs`, новая попытка. */
const stepBackScenario = async (policy: Policy, backMs: number) => {
  const device = createDevice(policy, 'a', createFakeClock());
  await device.write(attempt);
  device.clock.advance(1_000);
  await device.write(reset);
  device.clock.advance(-backMs);
  await device.write(attempt);
  return rebuildFrom(device);
};

describe('HLC rule for at (T-23)', () => {
  it('(а) reset and unset written after import cover the imported attempt and flag at ±1 day of skew', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: -DAY_MS, max: DAY_MS }),
        async (skewMs) => {
          expect(await skewScenario('hlc', skewMs)).toEqual({
            attempts: 0,
            blacklisted: false,
          });
        },
      ),
      { seed: SEED, numRuns: 500 },
    );
  });

  it('(б) a new attempt after an own reset stays alive when the clock steps back', async () => {
    expect(await stepBackScenario('hlc', 10 * MINUTE_MS)).toEqual({
      attempts: 1,
      blacklisted: false,
    });
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: DAY_MS }), async (backMs) => {
        expect((await stepBackScenario('hlc', backMs)).attempts).toBe(1);
      }),
      { seed: SEED, numRuns: 100 },
    );
  });

  it('(в) a far-future request is clamped to now + 5 min; above the clamp only seen and own past at lift it', async () => {
    const clock = createFakeClock();
    const now = clock.now();
    const device = createDevice('hlc', 'a', clock);
    const future = await device.write(attempt, now + DAY_MS);
    expect(future.at).toBe(now + FIVE_MIN_MS);

    // собственный прошлый `at` выше зажима поднимает следующую запись: +1 к увиденному
    const next = await device.write(attempt);
    expect(next.at).toBe(future.at + 1);

    // увиденный чужой `at` выше зажима: следующая запись = увиденный + 1, не `now + 5 мин`
    const peer = createDevice('hlc', 'b', createFakeClock());
    peer.clock.advance(2 * DAY_MS);
    const foreign = await peer.write(attempt);
    await importInto(device, [foreign]);
    const after = await device.write(attempt, now + DAY_MS);
    expect(after.at).toBe(foreign.at + 1);
    expect(after.at).toBeGreaterThan(now + FIVE_MIN_MS);
  });

  it('(г) the wall-clock mutant fails (а) and (б): the attempt outlives the reset iff skew >= 60 s', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: -DAY_MS, max: DAY_MS }),
        async (skewMs) => {
          const survives = skewMs >= MINUTE_MS;
          expect(await skewScenario('wall', skewMs)).toEqual({
            attempts: survives ? 1 : 0,
            blacklisted: survives,
          });
        },
      ),
      { seed: SEED, numRuns: 500 },
    );
    expect((await skewScenario('wall', DAY_MS)).attempts).toBe(1);
    expect((await stepBackScenario('wall', 10 * MINUTE_MS)).attempts).toBe(0);
  });
});
