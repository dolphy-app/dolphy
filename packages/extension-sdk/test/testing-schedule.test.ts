import { describe, expect, it } from 'vitest';
import { defineExtension } from '../src/index.ts';
import type { ExtensionContext } from '../src/index.ts';
import { createMemorySchedule, loadSchedules } from '../src/testing.ts';

const deferred = () => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('createMemorySchedule', () => {
  it('fire runs the subscribed handler and resolves true once it returned', async () => {
    const schedule = createMemorySchedule();
    const log: string[] = [];
    schedule.on('a.morning', async () => {
      await Promise.resolve();
      log.push('ran');
    });

    expect(await schedule.fire('a.morning')).toBe(true);
    expect(log).toEqual(['ran']);
    expect(schedule.ids()).toEqual(['a.morning']);
  });

  it('an id with no subscription is skipped like in the host', async () => {
    const schedule = createMemorySchedule();
    expect(await schedule.fire('a.ghost')).toBe(false);
  });

  it('a handler failure rejects the promise instead of being swallowed', async () => {
    const schedule = createMemorySchedule();
    schedule.on('a.morning', () => {
      throw new Error('boom');
    });
    await expect(schedule.fire('a.morning')).rejects.toThrow('boom');
    // the failed run is over: the next firing is delivered
    schedule.on('a.other', () => undefined);
    expect(await schedule.fire('a.other')).toBe(true);
  });

  it('a firing while the previous handler still runs is skipped; after it returns the next one runs', async () => {
    const schedule = createMemorySchedule();
    const gate = deferred();
    let calls = 0;
    schedule.on('a.slow', async () => {
      calls += 1;
      await gate.promise;
    });

    const first = schedule.fire('a.slow');
    expect(await schedule.fire('a.slow')).toBe(false);
    expect(calls).toBe(1);
    gate.resolve();
    expect(await first).toBe(true);
    expect(await schedule.fire('a.slow')).toBe(true);
    expect(calls).toBe(2);
  });

  it('declared limits subscriptions to the manifest; a second subscription throws; dispose unsubscribes', async () => {
    const schedule = createMemorySchedule({ declared: ['a.morning'] });
    expect(() => schedule.on('a.other', () => undefined)).toThrow(
      "schedule 'a.other' is not declared in the manifest",
    );
    const subscription = schedule.on('a.morning', () => undefined);
    expect(() => schedule.on('a.morning', () => undefined)).toThrow(
      "schedule 'a.morning' is already subscribed",
    );
    await subscription.dispose();
    expect(schedule.ids()).toEqual([]);
    expect(await schedule.fire('a.morning')).toBe(false);
  });
});

describe('loadSchedules', () => {
  it('activates the module with in-memory schedules; defineExtension records and ctx.schedule.on both subscribe', async () => {
    const log: string[] = [];
    const module = defineExtension({
      schedules: {
        'a.morning': () => void log.push('record'),
        'a.late': async () => undefined,
      },
      activate(ctx: ExtensionContext) {
        ctx.schedule.on('a.extra', () => void log.push('activate'));
      },
    });
    const loaded = await loadSchedules(module, {
      declared: ['a.morning', 'a.late', 'a.extra'],
    });

    expect(loaded.ids()).toEqual(['a.morning', 'a.late', 'a.extra']);
    expect(await loaded.fire('a.morning')).toBe(true);
    expect(await loaded.fire('a.extra')).toBe(true);
    expect(log).toEqual(['record', 'activate']);

    // deactivate disposes the subscriptions the records made; the one made in `activate` is the author's to release
    await loaded.dispose();
    expect(loaded.ids()).toEqual(['a.extra']);
  });
});
