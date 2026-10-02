import type { EngineEvent, LearningEvent } from '@dolphy-app/engine-contract';
import { createCapturingLogger } from '@dolphy-app/testkit';
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

  it('publish delivers at once and leaves the buffer alone', () => {
    const { logger } = createCapturingLogger();
    const bus = createEventBus(logger);
    const seen: EngineEvent[] = [];
    bus.subscribe((event) => seen.push(event));
    bus.emit(progress(1));
    bus.publish(progress(2));
    expect(seen).toEqual([progress(2)]);
    bus.discard();
    bus.flush();
    expect(seen).toEqual([progress(2)]);
    bus.emit(progress(3));
    bus.publish(progress(4));
    bus.flush();
    expect(seen).toEqual([progress(2), progress(4), progress(3)]);
  });
});

const started = (sessionId: string): LearningEvent => ({
  name: 'session.started',
  payload: { sessionId, at: 1 },
});

describe('createEventBus: learning sink', () => {
  it('buffers with the command cycle: nothing before flush, dropped on discard', () => {
    const { logger } = createCapturingLogger();
    const bus = createEventBus(logger);
    const seen: LearningEvent[] = [];
    bus.subscribeLearning((event) => {
      seen.push(event);
    });
    bus.emitLearning(started('a'));
    expect(seen).toEqual([]);
    bus.discard();
    bus.flush();
    expect(seen).toEqual([]);
    bus.emitLearning(started('b'));
    bus.emitLearning(started('c'));
    bus.flush();
    bus.flush();
    expect(seen).toEqual([started('b'), started('c')]);
  });

  it('flush delivers engine events first, then learning events; the windows never see learning events', () => {
    const { logger } = createCapturingLogger();
    const bus = createEventBus(logger);
    const order: string[] = [];
    bus.subscribe((event) => order.push(`engine:${event.type}`));
    bus.subscribeLearning((event) => {
      order.push(`learning:${event.name}`);
    });
    bus.emitLearning(started('a'));
    bus.emit(progress(1));
    bus.flush();
    expect(order).toEqual(['engine:progress', 'learning:session.started']);
  });

  it('a throwing or rejecting listener is logged and does not stop the others', async () => {
    const { logger, records } = createCapturingLogger();
    const bus = createEventBus(logger);
    const seen: LearningEvent[] = [];
    bus.subscribeLearning(() => {
      throw new Error('sync failure');
    });
    bus.subscribeLearning(() => Promise.reject(new Error('async failure')));
    bus.subscribeLearning((event) => {
      seen.push(event);
    });
    bus.emitLearning(started('a'));
    expect(() => bus.flush()).not.toThrow();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(seen).toEqual([started('a')]);
    expect(records.filter(({ level }) => level === 'error')).toHaveLength(2);
  });

  it('unsubscribe stops delivery', () => {
    const { logger } = createCapturingLogger();
    const bus = createEventBus(logger);
    const seen: LearningEvent[] = [];
    const off = bus.subscribeLearning((event) => {
      seen.push(event);
    });
    off();
    bus.emitLearning(started('a'));
    bus.flush();
    expect(seen).toEqual([]);
  });
});
