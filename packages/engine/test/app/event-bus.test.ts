import type { EngineEvent } from '@lms/engine-contract';
import { createCapturingLogger } from '@lms/testkit';
import { describe, expect, it } from 'vitest';
import { createEventBus } from '../../src/app/index.ts';

const progress = (at: number): EngineEvent => ({
  type: 'progress',
  unitIds: ['u'],
  at,
});

describe('createEventBus', () => {
  it('delivers nothing before flush and everything in order after it', () => {
    const { logger } = createCapturingLogger();
    const bus = createEventBus(logger);
    const seen: EngineEvent[] = [];
    bus.subscribe((event) => seen.push(event));
    bus.emit(progress(1));
    bus.emit(progress(2));
    expect(seen).toEqual([]);
    bus.flush();
    expect(seen).toEqual([progress(1), progress(2)]);
    bus.flush();
    expect(seen).toHaveLength(2);
  });

  it('discard drops events of a failed command', () => {
    const { logger } = createCapturingLogger();
    const bus = createEventBus(logger);
    const seen: EngineEvent[] = [];
    bus.subscribe((event) => seen.push(event));
    bus.emit(progress(1));
    bus.discard();
    bus.emit(progress(2));
    bus.flush();
    expect(seen).toEqual([progress(2)]);
  });

  it('a throwing listener is logged and does not stop the others', () => {
    const { logger, records } = createCapturingLogger();
    const bus = createEventBus(logger);
    const seen: EngineEvent[] = [];
    bus.subscribe(() => {
      throw new Error('bad listener');
    });
    bus.subscribe((event) => seen.push(event));
    bus.emit(progress(1));
    bus.flush();
    expect(seen).toEqual([progress(1)]);
    expect(records).toHaveLength(1);
    expect(records[0]?.level).toBe('error');
  });

  it('unsubscribe stops delivery and removes the listener', () => {
    const { logger } = createCapturingLogger();
    const bus = createEventBus(logger);
    const seen: EngineEvent[] = [];
    const off = bus.subscribe((event) => seen.push(event));
    off();
    bus.emit(progress(1));
    bus.flush();
    expect(seen).toEqual([]);
  });

  it('a listener may unsubscribe itself during delivery', () => {
    const { logger } = createCapturingLogger();
    const bus = createEventBus(logger);
    const seen: number[] = [];
    const off = bus.subscribe(() => {
      seen.push(1);
      off();
    });
    bus.subscribe(() => seen.push(2));
    bus.emit(progress(1));
    bus.emit(progress(2));
    bus.flush();
    expect(seen).toEqual([1, 2, 2]);
  });
});
