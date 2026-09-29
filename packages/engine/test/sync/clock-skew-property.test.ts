/**
 * T-59 (свойство): карантин `clock-skew` — запись уходит в карантин ровно при
 * `at > recordedAt + 24 ч` либо `at > now получателя + 24 ч` (второе правило —
 * то, что ловит устройство с часами 2099 года, у которого и `recordedAt` из 2099); карантинная запись не «отравляет» `maxAtУвиденный`:
 * следующая запись здорового устройства не получает `at` выше собственного
 * `now + 5 мин` из-за неё. Примеры границ и устройство с часами 2099 года —
 * в `replica.test.ts`.
 */
import { buildAttempt, createFakeClock, createTestIds } from '@lms/testkit';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FIVE_MIN_MS, createJournalWriter } from '../../src/app/index.ts';
import { createMemoryEventStore } from '../../src/node/index.ts';
import { CLOCK_SKEW_LIMIT_MS, createReplica } from '../../src/sync/index.ts';

const SEED = 20_260_929;
const DAY_MS = 86_400_000;

describe('clock-skew quarantine property (T-59)', () => {
  it('quarantined iff at > recordedAt + 24 h or at > now + 24 h, and a healthy write is never lifted above now + 5 min by a quarantined entry', async () => {
    await fc.assert(
      fc.asyncProperty(
        // сдвиг `at` относительно границы: плотно у границы и на годы вперёд
        fc.oneof(
          fc.integer({ min: -3, max: 3 }),
          fc.integer({ min: -DAY_MS, max: 3_650 * DAY_MS }),
        ),
        fc.integer({ min: -DAY_MS, max: DAY_MS }),
        async (offsetMs, recordedSkewMs) => {
          const clock = createFakeClock();
          const store = createMemoryEventStore({ deviceId: 'receiver' });
          const replica = createReplica({ store, clock });
          const recordedAt = clock.now() + recordedSkewMs;
          const at = recordedAt + CLOCK_SKEW_LIMIT_MS + offsetMs;
          const remote = buildAttempt({
            deviceId: 'remote',
            seq: 1,
            at,
            recordedAt,
            exerciseId: 'e',
          });

          const outcome = await replica.ingest([remote]);
          const quarantined =
            offsetMs > 0 || at > clock.now() + CLOCK_SKEW_LIMIT_MS;
          expect(outcome.inserted).toBe(quarantined ? 0 : 1);
          expect(outcome.conflictIds).toEqual(
            quarantined ? [`clock-skew:${remote.id}`] : [],
          );
          expect(store.maxAt()).toBe(quarantined ? 0 : at);

          if (quarantined) {
            const writer = createJournalWriter({
              clock,
              ids: createTestIds('receiver'),
              eventStore: store,
            });
            const own = writer.build({
              kind: 'attempt',
              exerciseId: 'e',
              grade: 3,
              source: 'self',
            });
            expect(own.at).toBeLessThanOrEqual(clock.now() + FIVE_MIN_MS);
          }
        },
      ),
      { seed: SEED, numRuns: 500 },
    );
  });
});
