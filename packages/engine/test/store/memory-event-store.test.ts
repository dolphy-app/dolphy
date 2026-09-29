import { describe, expect, it } from 'vitest';
import { createMemoryEventStore } from '../../src/node/index.ts';
import { describeEventStoreContract } from './contract.ts';

describeEventStoreContract('MemoryEventStore', async (deviceId) => {
  const store = createMemoryEventStore({ deviceId });
  return { store, dispose: () => store.close() };
});

describe('MemoryEventStore', () => {
  it('rejects invalid initial entries', () => {
    const bad = {
      kind: 'attempt',
      id: 'x',
      deviceId: 'a',
      seq: 1,
      at: 1,
      recordedAt: 1,
      exerciseId: 'e',
      grade: 9,
      source: 'self',
    };
    expect(() => createMemoryEventStore({ entries: [bad as never] })).toThrow(
      /invalid log entry/,
    );
  });
});
