import type {
  ExtensionHookRequests,
  ExtensionHooks,
} from '@dolphy-app/engine/ports';
import type { ServerContext } from '@dolphy-app/extension-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { candidateOf } from './helpers.ts';
import { createHarness } from './state-harness.ts';
import type { Harness } from './state-harness.ts';

let harness: Harness | null = null;
afterEach(async () => {
  vi.useRealTimers();
  await harness?.close();
  harness = null;
});

type Server = (s: ServerContext) => unknown;

/** Хост с расширениями `servers` (id → серверная часть). */
const open = async (
  servers: Record<string, Server>,
  options: Partial<Parameters<typeof createHarness>[0]> = {},
): Promise<Harness> => {
  harness = await createHarness({
    candidates: Object.keys(servers).map((id) => candidateOf(id)),
    modules: Object.fromEntries(
      Object.entries(servers).map(([id, server]) => [
        id,
        { server: (s: ServerContext) => void server(s) },
      ]),
    ),
    ...options,
  });
  return harness;
};

const BATCH: ExtensionHookRequests['practice.batch'] = {
  sessionId: 's1',
  source: 'batch',
  exerciseIds: ['x', 'y'],
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
      retrievability: 0.4,
      lastAttemptAt: 1_000,
      attempts: 2,
      stability: 3,
      difficulty: 5,
    },
  ],
};

const batch = (hooks: ExtensionHooks, request = BATCH) =>
  hooks.before('practice.batch', request);

const failure = async (call: Promise<unknown>): Promise<unknown> =>
  call.then(
    () => 'resolved',
    (error: unknown) => error,
  );

describe('runHook: обработчик в хосте', () => {
  it('запрос доходит обработчику, ответ возвращается проверенным', async () => {
    const seen: unknown[] = [];
    const h = await open({
      'acme.a': (s) =>
        s.before('practice.batch', (request) => {
          seen.push(request);
          return { exerciseIds: ['y', 'x'], reasons: ['review', 'new'] };
        }),
    });

    expect(await batch(h.hooks)).toEqual({
      exerciseIds: ['y', 'x'],
      reasons: ['review', 'new'],
    });
    expect(seen).toEqual([BATCH]);
  });

  it('хук без ответа: обработчик получает запрос, результат — undefined', async () => {
    const seen: unknown[] = [];
    const h = await open({
      'acme.a': (s) =>
        s.before('session.start', (request) => void seen.push(request)),
    });

    expect(await h.hooks.before('session.start', { now: 5 })).toBeUndefined();
    expect(seen).toEqual([{ now: 5 }]);
  });

  it('ошибка обработчика отменяет операцию: failed с текстом расширения', async () => {
    const h = await open({
      'acme.a': (s) =>
        s.before('session.start', () => {
          throw new Error('not today');
        }),
    });

    expect(
      await failure(h.hooks.before('session.start', { now: 1 })),
    ).toMatchObject({
      name: 'ExtensionHookError',
      reason: 'failed',
      hook: 'session.start',
      extensionId: 'acme.a',
      message: 'not today',
    });
  });

  it('асинхронный отказ обработчика тоже failed', async () => {
    const h = await open({
      'acme.a': (s) =>
        s.before('session.start', async () => {
          throw new Error('later');
        }),
    });

    expect(
      await failure(h.hooks.before('session.start', { now: 1 })),
    ).toMatchObject({ reason: 'failed', message: 'later' });
  });

  it.each([
    [
      'массивы разной длины',
      { exerciseIds: ['x'], reasons: [] },
      'same length',
    ],
    [
      'неизвестная причина',
      { exerciseIds: ['x'], reasons: ['other'] },
      'reasons',
    ],
    ['не объект', 'x', 'expected object'],
    ['пустота', undefined, 'expected object'],
  ])('ответ не по схеме (%s): invalid-result', async (_name, result, text) => {
    const h = await open({
      'acme.a': (s) => s.before('practice.batch', () => result as never),
    });

    expect(await failure(batch(h.hooks))).toMatchObject({
      reason: 'invalid-result',
      extensionId: 'acme.a',
      message: expect.stringContaining(text),
    });
  });

  it('хук без ответа: любое значение, кроме undefined, — invalid-result', async () => {
    const h = await open({
      'acme.a': (s) => s.before('session.start', () => 5 as never),
    });

    expect(
      await failure(h.hooks.before('session.start', { now: 1 })),
    ).toMatchObject({ reason: 'invalid-result' });
  });

  it('больше потолка упражнений в ответе — invalid-result', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `e${i}`);
    const h = await open({
      'acme.a': (s) =>
        s.before('practice.batch', () => ({
          exerciseIds: ids,
          reasons: ids.map(() => 'new' as const),
        })),
    });

    expect(await failure(batch(h.hooks))).toMatchObject({
      reason: 'invalid-result',
    });
  });

  it('обработчик, не уложившийся в 30 с, — timeout; хост не перезапускается, сбой попадает в здоровье', async () => {
    const restart = vi.fn();
    const h = await open(
      {
        'acme.a': (s) =>
          s.before('session.start', () => new Promise<void>(() => {})),
      },
      { restart },
    );
    vi.useFakeTimers();

    const outcome = failure(h.hooks.before('session.start', { now: 1 }));
    await vi.advanceTimersByTimeAsync(29_900);
    expect(restart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);

    expect(await outcome).toMatchObject({
      name: 'ExtensionHookError',
      reason: 'timeout',
      extensionId: 'acme.a',
    });
    expect(restart).not.toHaveBeenCalled();
    expect(h.engine.health.get('acme.a').failures).toBe(1);
  });

  it('ошибка обработчика отменой по замыслу: здоровье не считает её сбоем', async () => {
    const h = await open({
      'acme.a': (s) =>
        s.before('session.start', () => {
          throw new Error('no');
        }),
    });

    await failure(h.hooks.before('session.start', { now: 1 }));

    expect(h.engine.health.get('acme.a').failures).toBe(0);
  });

  it('хост недоступен: host-down', async () => {
    const h = await open({
      'acme.a': (s) => s.before('session.start', () => {}),
    });
    await h.channel.close();

    expect(
      await failure(h.hooks.before('session.start', { now: 1 })),
    ).toMatchObject({ reason: 'host-down', extensionId: 'acme.a' });
  });
});
