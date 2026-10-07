/**
 * Хуки «до» расширений (спека extension-runtime, R10): `practice.startSession`
 * вызывает `session.start`, `practice.getBatch` и `plan.getDay` — `practice.batch`.
 * Отказ расширения отменяет операцию и ничего не меняет.
 */
import { buildLibrary, createFakeExtensionHooks } from '@dolphy-app/testkit';
import type { FakeHookHandlers } from '@dolphy-app/testkit';
import { describe, expect, it } from 'vitest';
import { EngineError } from '../../src/app/errors.ts';
import { createTestEngine } from '../helpers/engine.ts';

const GHOST = 'c::l::ghost';

const open = (hooks: FakeHookHandlers) =>
  createTestEngine({
    library: buildLibrary({
      courses: [{ id: 'c', lessons: [{ id: 'l', exercises: 3 }] }],
    }),
    extensionHooks: createFakeExtensionHooks({ 'acme.hook': hooks }),
  });

const failureOf = async (call: Promise<unknown>): Promise<EngineError> => {
  try {
    await call;
  } catch (error) {
    if (error instanceof EngineError) return error;
    throw error;
  }
  throw new Error('expected the call to reject');
};

describe('session.start', () => {
  it('runs before the session is created and gets the time', async () => {
    const seen: unknown[] = [];
    const t = await open({
      'session.start': (request) => {
        seen.push({ request, learning: t.learning.length });
      },
    });

    const { sessionId } = await t.engine.practice.startSession();

    expect(seen).toEqual([{ request: { now: t.clock.now() }, learning: 0 }]);
    expect(t.learning).toEqual([
      expect.objectContaining({
        name: 'session.started',
        payload: expect.objectContaining({ sessionId }),
      }),
    ]);
  });

  it('a refusal cancels the start: no session, no event, the journal is untouched', async () => {
    const t = await open({
      'session.start': () => {
        throw new Error('not today');
      },
    });
    const entries = t.eventStore.entryCount();

    const error = await failureOf(t.engine.practice.startSession());

    expect(error.code).toBe('EXTENSION_HOOK_FAILED');
    expect(error.message).toBe("Extension 'acme.hook': not today");
    expect(error.details).toEqual({
      hook: 'session.start',
      extensionId: 'acme.hook',
      reason: 'failed',
      message: 'not today',
    });
    expect(t.learning).toEqual([]);
    expect(t.eventStore.entryCount()).toBe(entries);
  });
});

describe('practice.batch in getBatch', () => {
  it('applies the order, the reasons and the removals of the extension', async () => {
    const requests: unknown[] = [];
    const t = await open({
      'practice.batch': (request) => {
        requests.push(request);
        return {
          exerciseIds: [...request.exerciseIds].reverse().slice(0, 2),
          reasons: ['remediation', 'review'],
        };
      },
    });

    const batch = await t.engine.practice.getBatch();

    const [request] = requests as {
      exerciseIds: string[];
      sessionId: string | null;
      source: string;
    }[];
    expect(request).toMatchObject({ sessionId: null, source: 'batch' });
    expect(request?.exerciseIds.length).toBe(3);
    expect(batch.exercises.map(({ id }) => id)).toEqual(
      [...(request?.exerciseIds ?? [])].reverse().slice(0, 2),
    );
    expect(batch.reasons).toEqual(['remediation', 'review']);
  });

  it('an exercise that is not in the library cancels the batch: no session, the journal is untouched', async () => {
    const t = await open({
      'practice.batch': () => ({ exerciseIds: [GHOST], reasons: ['new'] }),
    });
    const entries = t.eventStore.entryCount();

    const error = await failureOf(t.engine.practice.getBatch());

    expect(error.code).toBe('EXTENSION_HOOK_FAILED');
    expect(error.details).toMatchObject({
      hook: 'practice.batch',
      extensionId: 'acme.hook',
      reason: 'invalid-result',
    });
    expect(error.message).toContain(GHOST);
    expect(t.learning).toEqual([]);
    expect(t.eventStore.entryCount()).toBe(entries);
  });

  it('a refusal cancels the batch and opens no session', async () => {
    const t = await open({
      'practice.batch': () => {
        throw new Error('no batch');
      },
    });

    const error = await failureOf(t.engine.practice.getBatch());

    expect(error.message).toBe("Extension 'acme.hook': no batch");
    expect(t.learning).toEqual([]);
  });

  it('hands over the memory of every exercise: parallel arrays, null for an exercise without attempts', async () => {
    const requests: {
      exerciseIds: string[];
      memory: {
        retrievability: number | null;
        lastAttemptAt: number | null;
        attempts: number;
        stability: number | null;
        difficulty: number | null;
      }[];
    }[] = [];
    const t = await open({
      'practice.batch': (request) => {
        requests.push(request);
        return { exerciseIds: request.exerciseIds, reasons: request.reasons };
      },
    });
    const attemptedAt = t.clock.now();
    await t.engine.practice.recordAttempt({
      requestId: 'r1',
      exerciseId: 'c::l::e1',
      grade: 5,
    });
    t.clock.advance(3 * 86_400_000);

    await t.engine.practice.getBatch();

    const [request] = requests;
    expect(request?.memory.length).toBe(request?.exerciseIds.length);
    const byId = new Map(
      request?.exerciseIds.map((id, i) => [id, request.memory[i]]),
    );
    expect(byId.get('c::l::e1')).toEqual({
      retrievability: expect.any(Number),
      lastAttemptAt: attemptedAt,
      attempts: 1,
      stability: expect.any(Number),
      difficulty: expect.any(Number),
    });
    const recalled = byId.get('c::l::e1')?.retrievability ?? 2;
    expect(recalled).toBeGreaterThan(0);
    expect(recalled).toBeLessThan(1);
    for (const id of ['c::l::e0', 'c::l::e2']) {
      expect(byId.get(id)).toEqual({
        retrievability: null,
        lastAttemptAt: null,
        attempts: 0,
        stability: null,
        difficulty: null,
      });
    }
  });

  it('the open session is reported to the hook', async () => {
    const sessions: unknown[] = [];
    const t = await open({
      'practice.batch': (request) => {
        sessions.push(request.sessionId);
        return { exerciseIds: request.exerciseIds, reasons: request.reasons };
      },
    });

    const { sessionId } = await t.engine.practice.startSession();
    await t.engine.practice.getBatch();

    expect(sessions).toEqual([sessionId]);
  });

  it('a cancelled session.start cancels the batch that would open a session', async () => {
    const t = await open({
      'session.start': () => {
        throw new Error('closed');
      },
    });

    const error = await failureOf(t.engine.practice.getBatch());

    expect(error.details).toMatchObject({ hook: 'session.start' });
    expect(t.learning).toEqual([]);
  });
});

describe('practice.batch in plan.getDay', () => {
  it('applies the extension answer and tells it the source', async () => {
    const requests: { source: string }[] = [];
    const t = await open({
      'practice.batch': (request) => {
        requests.push(request);
        return {
          exerciseIds: [...request.exerciseIds].reverse(),
          reasons: request.reasons.map(() => 'review' as const),
        };
      },
    });

    const day = await t.engine.plan.getDay({ maxItems: 10, seed: 1 });

    expect(requests.map(({ source }) => source)).toEqual(['plan']);
    expect(day.items).toHaveLength(3);
    expect(day.items.map(({ reason }) => reason)).toEqual([
      'review',
      'review',
      'review',
    ]);
    const plain = await createTestEngine({
      library: buildLibrary({
        courses: [{ id: 'c', lessons: [{ id: 'l', exercises: 3 }] }],
      }),
    });
    const base = await plain.engine.plan.getDay({ maxItems: 10, seed: 1 });
    expect(day.items.map(({ exerciseId }) => exerciseId)).toEqual(
      base.items.map(({ exerciseId }) => exerciseId).reverse(),
    );
  });

  it('may add an exercise the plan did not contain, beyond maxItems', async () => {
    const t = await open({
      'practice.batch': (request) => ({
        exerciseIds: [...request.exerciseIds, 'c::l::e2'],
        reasons: [...request.reasons, 'new'],
      }),
    });

    const day = await t.engine.plan.getDay({ maxItems: 1, seed: 1 });

    expect(day.items.length).toBe(2);
    expect(day.items.at(-1)).toEqual({ exerciseId: 'c::l::e2', reason: 'new' });
  });

  it('an unknown exercise cancels the plan', async () => {
    const t = await open({
      'practice.batch': () => ({ exerciseIds: [GHOST], reasons: ['new'] }),
    });

    const error = await failureOf(t.engine.plan.getDay({ maxItems: 5 }));

    expect(error.code).toBe('EXTENSION_HOOK_FAILED');
    expect(error.details).toMatchObject({ reason: 'invalid-result' });
  });
});
