import { describe, expect, it } from 'vitest';
import { createCommandQueue } from '../../src/app/index.ts';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('createCommandQueue', () => {
  it('runs tasks strictly one at a time in FIFO order', async () => {
    const queue = createCommandQueue();
    const log: string[] = [];
    const gate = deferred<void>();
    const first = queue.enqueue(async () => {
      log.push('a:start');
      await gate.promise;
      log.push('a:end');
      return 'a';
    });
    const second = queue.enqueue(async () => {
      log.push('b:start');
      return 'b';
    });
    await Promise.resolve();
    expect(log).toEqual(['a:start']);
    gate.resolve();
    expect(await Promise.all([first, second])).toEqual(['a', 'b']);
    expect(log).toEqual(['a:start', 'a:end', 'b:start']);
  });

  it('a failed task rejects its caller but does not break the chain', async () => {
    const queue = createCommandQueue();
    const failed = queue.enqueue(() => Promise.reject(new Error('boom')));
    const next = queue.enqueue(() => Promise.resolve(42));
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe(42);
  });

  it('idle waits for the running and queued tasks', async () => {
    const queue = createCommandQueue();
    const gate = deferred<void>();
    let finished = false;
    void queue.enqueue(async () => {
      await gate.promise;
      finished = true;
    });
    const idle = queue.idle();
    gate.resolve();
    await idle;
    expect(finished).toBe(true);
  });

  it('idle resolves even if the last task failed', async () => {
    const queue = createCommandQueue();
    const failed = queue.enqueue(() => Promise.reject(new Error('x')));
    failed.catch(() => null);
    await expect(queue.idle()).resolves.toBeUndefined();
  });
});
