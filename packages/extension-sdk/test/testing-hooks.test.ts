import { describe, expect, it } from 'vitest';
import { createTestServer } from '../src/testing.ts';

describe('createTestServer: hooks', () => {
  it('registration lists the hooks; hook() runs the handler and checks the response', async () => {
    const running = await createTestServer((s) => {
      s.before('practice.batch', ({ exerciseIds, reasons }) => ({
        exerciseIds: [...exerciseIds].reverse(),
        reasons: [...reasons].reverse(),
      }));
    });

    expect(running.registration.hooks).toEqual(['practice.batch']);
    expect(
      await running.hook('practice.batch', {
        sessionId: null,
        source: 'batch',
        exerciseIds: ['a', 'b'],
        reasons: ['new', 'review'],
        memory: [
          {
            retrievability: null,
            lastAttemptAt: null,
            attempts: 0,
            stability: null,
            difficulty: null,
          },
          {
            retrievability: 0.5,
            lastAttemptAt: 1,
            attempts: 1,
            stability: 2,
            difficulty: 5,
          },
        ],
      }),
    ).toEqual({ exerciseIds: ['b', 'a'], reasons: ['review', 'new'] });
  });

  it('rejects with the error of the handler', async () => {
    const running = await createTestServer((s) => {
      s.before('session.start', () => {
        throw new Error('not today');
      });
    });

    await expect(running.hook('session.start', { now: 1 })).rejects.toThrow(
      'not today',
    );
  });

  it('rejects a request and a response that break the schema of the hook', async () => {
    const running = await createTestServer((s) => {
      s.before('practice.batch', () => ({ exerciseIds: ['a'], reasons: [] }));
    });

    await expect(
      running.hook('practice.batch', {
        sessionId: null,
        source: 'plan',
        exerciseIds: ['a'],
        reasons: ['new'],
        memory: [
          {
            retrievability: null,
            lastAttemptAt: null,
            attempts: 0,
            stability: null,
            difficulty: null,
          },
        ],
      }),
    ).rejects.toThrow('same length');
    await expect(
      running.hook('practice.batch', { sessionId: null } as never),
    ).rejects.toThrow();
  });

  it('rejects an unregistered hook, an unknown name and a second registration', async () => {
    const running = await createTestServer((s) => {
      s.before('session.start', () => {});
    });
    await expect(
      running.hook('practice.batch', {
        sessionId: null,
        source: 'plan',
        exerciseIds: [],
        reasons: [],
        memory: [],
      }),
    ).rejects.toThrow("hook 'practice.batch' was not registered");

    await expect(
      createTestServer((s) => {
        s.before('session.end' as never, (() => {}) as never);
      }),
    ).rejects.toThrow('not a known hook');
    await expect(
      createTestServer((s) => {
        s.before('session.start', () => {});
        s.before('session.start', () => {});
      }),
    ).rejects.toThrow('already registered');
  });
});
