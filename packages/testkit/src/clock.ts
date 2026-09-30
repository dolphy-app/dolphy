import type { EpochMs } from '@dolphy-app/engine-contract';
import type { Clock } from '@dolphy-app/engine';

/** 2027-01-15T08:00:00Z: значение `T0` спайков; далеко от нуля и от `Date.now()`. */
export const T0_MS: EpochMs = 1_800_000_000_000;

export interface FakeClock extends Clock {
  advance(ms: number): EpochMs;
  set(ms: EpochMs): EpochMs;
}

/** Ручные часы: время идёт только через `advance` и `set`. */
export const createFakeClock = (startMs: EpochMs = T0_MS): FakeClock => {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
      return current;
    },
    set: (ms) => {
      current = ms;
      return current;
    },
  };
};
