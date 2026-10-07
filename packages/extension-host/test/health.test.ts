import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTIVATION_TIMEOUT_MS } from '../src/runtime.ts';
import type { ServerModule } from '../src/runtime.ts';
import { candidateOf } from './helpers.ts';
import { attemptClosed, createHarness } from './state-harness.ts';
import type { Harness } from './state-harness.ts';

const ID = 'acme.h';

let harness: Harness | null = null;
afterEach(async () => {
  vi.useRealTimers();
  await harness?.close();
  harness = null;
});

/** Хост без расширений: серверные части подкладываются в `modules` до замены набора. */
const open = async (
  modules: Record<string, ServerModule> = {},
  candidates = [candidateOf(ID, { revision: 'r1' })],
) => {
  harness = await createHarness({ candidates, modules });
  return harness;
};

const candidate = (id = ID, revision = 'r1') => candidateOf(id, { revision });

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** Доставляет сообщения хоста движку: учёт здоровья идёт через канал. */
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('здоровье расширения: хост → движок', () => {
  it('успешная регистрация записывает длительность server; расширение без вклада — тоже, но без сбоев', async () => {
    vi.useFakeTimers();
    const modules: Record<string, ServerModule> = {};
    const h = await open(modules, []);
    modules[ID] = {
      server: async () => {
        await sleep(30);
      },
    };
    modules['acme.quick'] = { server: () => {} };
    const pending = h.replace([candidate(), candidate('acme.quick')]);
    await vi.advanceTimersByTimeAsync(30);
    await pending;
    await flush();
    expect(h.engine.health.get(ID)).toMatchObject({
      failures: 0,
      lastFailure: null,
      lastActivationMs: 30,
    });
    expect(h.engine.health.get('acme.quick')).toMatchObject({
      failures: 0,
      lastActivationMs: 0,
    });
  });

  it('server бросает: сбой activation-failed с сообщением, длительность не записана', async () => {
    vi.useFakeTimers();
    const modules: Record<string, ServerModule> = {};
    const h = await open(modules, []);
    modules[ID] = {
      server: () => {
        throw new Error('boom');
      },
    };
    await h.replace([candidate()]);
    await flush();
    expect(h.engine.health.get(ID)).toMatchObject({
      failures: 1,
      lastFailure: { reason: 'activation-failed', message: 'boom' },
      lastActivationMs: null,
    });
  });

  it('server не уложился в срок: сбой activation-timeout', async () => {
    vi.useFakeTimers();
    const modules: Record<string, ServerModule> = {};
    const h = await open(modules, []);
    modules[ID] = { server: () => new Promise<void>(() => {}) };
    const pending = h.replace([candidate()]);
    await vi.advanceTimersByTimeAsync(ACTIVATION_TIMEOUT_MS);
    await pending;
    await flush();
    expect(h.engine.health.get(ID)).toMatchObject({
      failures: 1,
      lastFailure: { reason: 'activation-timeout' },
      lastActivationMs: null,
    });
  });

  it('исключение и просрочка обработчика события — сбои с причиной и сообщением', async () => {
    vi.useFakeTimers();
    const h = await open({
      [ID]: {
        server: (s) => {
          s.on('attempt.closed', async ({ exerciseId }) => {
            if (exerciseId === 'bad') throw new Error('handler bug');
            if (exerciseId === 'hang') await new Promise<void>(() => {});
          });
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
    vi.useFakeTimers();
    const stay = candidate('acme.stay');
    const h = await open(
      {
        [ID]: { server: () => {} },
        'acme.gone': { server: () => {} },
        'acme.stay': { server: () => {} },
      },
      [candidate(), candidate('acme.gone'), stay],
    );
    for (const id of [ID, 'acme.gone', 'acme.stay']) {
      h.engine.health.recordFailure(id, 'handler-failed', 'x');
    }

    await h.replace([candidate(ID, 'edited'), stay]);
    await flush();

    expect(h.engine.health.get(ID).failures).toBe(0);
    expect(h.engine.health.get('acme.gone').failures).toBe(0);
    expect(h.engine.health.get('acme.stay').failures).toBe(1);
  });
});
