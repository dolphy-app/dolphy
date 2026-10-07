import { afterEach, describe, expect, it, vi } from 'vitest';
import { attemptClosed, createHarness, stateful } from './state-harness.ts';
import type { Harness } from './state-harness.ts';

const ID = 'acme.h';

let harness: Harness | null = null;
afterEach(async () => {
  vi.useRealTimers();
  await harness?.close();
  harness = null;
});

const open = (...args: Parameters<typeof createHarness>): Harness => {
  harness = createHarness(...args);
  return harness;
};

describe('здоровье расширения: хост → движок', () => {
  it('успешная активация записывает длительность; расширение без активации — нули', async () => {
    const h = open({
      extensions: [stateful(ID), stateful('acme.idle', { events: [] })],
      modules: {
        [ID]: {
          activate: async (ctx) => {
            ctx.events.on('attempt.closed', () => {});
            await new Promise<void>((resolve) => {
              setTimeout(resolve, 30);
            });
          },
        },
        'acme.idle': { activate: () => {} },
      },
    });
    expect(h.engine.health.get(ID).lastActivationMs).toBeNull();

    h.engine.emit(attemptClosed('e1'));

    await vi.waitFor(() =>
      expect(h.engine.health.get(ID).lastActivationMs).toBeGreaterThanOrEqual(
        25,
      ),
    );
    expect(h.engine.health.get(ID).failures).toBe(0);
    expect(h.engine.health.get('acme.idle')).toEqual({
      id: 'acme.idle',
      failures: 0,
      lastFailure: null,
      lastActivationMs: null,
      suppressedUntil: null,
    });
  });

  it('сбой активации не записывает длительность', async () => {
    const h = open({
      extensions: [stateful(ID)],
      modules: {
        [ID]: {
          activate: () => {
            throw new Error('boom');
          },
        },
      },
    });
    h.engine.emit(attemptClosed('e1'));
    await vi.waitFor(() => expect(h.engine.health.get(ID).failures).toBe(1));
    expect(h.engine.health.get(ID).lastActivationMs).toBeNull();
  });

  it('исключение и просрочка обработчика события — сбои с причиной и сообщением', async () => {
    vi.useFakeTimers();
    const h = open({
      extensions: [stateful(ID)],
      modules: {
        [ID]: {
          activate: (ctx) => {
            ctx.events.on('attempt.closed', async ({ exerciseId }) => {
              if (exerciseId === 'bad') throw new Error('handler bug');
              if (exerciseId === 'hang') await new Promise<void>(() => {});
            });
          },
        },
      },
    });

    h.engine.emit(attemptClosed('good'));
    h.engine.emit(attemptClosed('bad'));
    await vi.advanceTimersByTimeAsync(10);
    expect(h.engine.health.get(ID)).toMatchObject({
      failures: 1,
      lastFailure: { reason: 'handler-failed', message: 'handler bug' },
    });

    h.engine.emit(attemptClosed('hang'));
    await vi.advanceTimersByTimeAsync(2100);
    expect(h.engine.health.get(ID)).toMatchObject({
      failures: 2,
      lastFailure: { reason: 'handler-timeout' },
    });
  });

  it('замена набора сбрасывает сводку изменённого и удалённого расширения, но не нетронутого', async () => {
    const stay = stateful('acme.stay');
    const h = open({
      extensions: [stateful(ID), stateful('acme.gone'), stay],
      modules: {
        [ID]: { activate: () => {} },
        'acme.gone': { activate: () => {} },
        'acme.stay': { activate: () => {} },
      },
    });
    for (const id of [ID, 'acme.gone', 'acme.stay']) {
      h.engine.health.recordFailure(id, 'handler-failed', 'x');
    }

    await h.replace([stateful(ID, { revision: 'edited' }), stay]);

    await vi.waitFor(() => {
      expect(h.engine.health.get(ID).failures).toBe(0);
      expect(h.engine.health.get('acme.gone').failures).toBe(0);
    });
    expect(h.engine.health.get('acme.stay').failures).toBe(1);
  });
});
