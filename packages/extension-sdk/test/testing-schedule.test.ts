import { describe, expect, it } from 'vitest';
import { defineServer } from '../src/index.ts';
import { createTestServer } from '../src/testing.ts';

const deferred = () => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const hourly = (id: string, handler: () => void | Promise<void>) =>
  createTestServer(
    defineServer((s) => {
      s.schedule({ id, every: 'hourly' }, handler);
    }),
  );

describe('createTestServer: schedule', () => {
  it('fire runs the registered handler and resolves true once it returned', async () => {
    const log: string[] = [];
    const server = await hourly('a.morning', async () => {
      await Promise.resolve();
      log.push('ran');
    });

    expect(await server.schedule.fire('a.morning')).toBe(true);
    expect(log).toEqual(['ran']);
  });

  it('an id nobody registered rejects', async () => {
    const server = await hourly('a.morning', () => undefined);
    await expect(server.schedule.fire('a.ghost')).rejects.toThrow(
      "schedule 'a.ghost' was not registered",
    );
  });

  it('a handler failure rejects the promise; the next firing is delivered', async () => {
    let fail = true;
    const server = await hourly('a.morning', () => {
      if (fail) throw new Error('boom');
    });
    await expect(server.schedule.fire('a.morning')).rejects.toThrow('boom');
    fail = false;
    expect(await server.schedule.fire('a.morning')).toBe(true);
  });

  it('a firing while the previous handler still runs is skipped; after it returns the next one runs', async () => {
    const gate = deferred();
    let calls = 0;
    const server = await hourly('a.slow', async () => {
      calls += 1;
      await gate.promise;
    });

    const first = server.schedule.fire('a.slow');
    expect(await server.schedule.fire('a.slow')).toBe(false);
    expect(calls).toBe(1);
    gate.resolve();
    expect(await first).toBe(true);
    expect(await server.schedule.fire('a.slow')).toBe(true);
    expect(calls).toBe(2);
  });

  it('a schedule id registered twice is an error; the snapshot keeps the time of a daily one', async () => {
    await expect(
      createTestServer(
        defineServer((s) => {
          s.schedule({ id: 'a.x', every: 'hourly' }, () => undefined);
          s.schedule({ id: 'a.x', every: 'hourly' }, () => undefined);
        }),
      ),
    ).rejects.toThrow("schedule 'a.x' is already registered");
    const server = await createTestServer(
      defineServer((s) => {
        s.schedule({ id: 'a.d', every: 'daily', at: '07:15' }, () => undefined);
      }),
    );
    expect(server.registration.schedules).toEqual([
      { id: 'a.d', every: 'daily', at: '07:15' },
    ]);
  });
});
