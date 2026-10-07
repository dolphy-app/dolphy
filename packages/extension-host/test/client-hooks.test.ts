import type { ExtensionHookRequests } from '@dolphy-app/engine/ports';
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

const open = async (servers: Record<string, Server>): Promise<Harness> => {
  harness = await createHarness({
    candidates: Object.keys(servers).map((id) => candidateOf(id)),
    modules: Object.fromEntries(
      Object.entries(servers).map(([id, server]) => [
        id,
        { server: (s: ServerContext) => void server(s) },
      ]),
    ),
  });
  return harness;
};

const BATCH: ExtensionHookRequests['practice.batch'] = {
  sessionId: 's1',
  source: 'plan',
  exerciseIds: ['x', 'y', 'z'],
  reasons: ['new', 'review', 'remediation'],
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
    {
      retrievability: 0.9,
      lastAttemptAt: 2_000,
      attempts: 1,
      stability: 8,
      difficulty: 6,
    },
  ],
};

const failure = async (call: Promise<unknown>): Promise<unknown> =>
  call.then(
    () => 'resolved',
    (error: unknown) => error,
  );

/** Хук `practice.batch`, который пишет в `calls` свой id и запрос, а отвечает `reply`. */
const recording =
  (
    calls: { id: string; request: unknown }[],
    id: string,
    reply: (request: ExtensionHookRequests['practice.batch']) => unknown,
  ): Server =>
  (s) =>
    s.before('practice.batch', (request) => {
      calls.push({ id, request });
      return reply(request) as never;
    });

describe('createRemoteExtensionHooks', () => {
  it('вызывает расширения по возрастанию id, а не в порядке обнаружения', async () => {
    const calls: { id: string; request: unknown }[] = [];
    const same = (request: ExtensionHookRequests['practice.batch']) => request;
    const h = await open({
      'acme.c': recording(calls, 'acme.c', same),
      'acme.a': recording(calls, 'acme.a', same),
      'acme.b': recording(calls, 'acme.b', same),
    });

    await h.hooks.before('practice.batch', BATCH);

    expect(calls.map(({ id }) => id)).toEqual(['acme.a', 'acme.b', 'acme.c']);
  });

  it('каждое расширение получает результат предыдущего, последнее решает итог', async () => {
    const calls: { id: string; request: unknown }[] = [];
    const h = await open({
      'acme.b': recording(calls, 'acme.b', () => ({
        exerciseIds: ['z', 'q'],
        reasons: ['remediation', 'new'],
      })),
      'acme.a': recording(calls, 'acme.a', () => ({
        exerciseIds: ['z', 'y'],
        reasons: ['remediation', 'review'],
      })),
    });

    const result = await h.hooks.before('practice.batch', BATCH);

    expect(calls).toEqual([
      { id: 'acme.a', request: BATCH },
      {
        id: 'acme.b',
        request: {
          ...BATCH,
          exerciseIds: ['z', 'y'],
          reasons: ['remediation', 'review'],
        },
      },
    ]);
    expect(result).toEqual({
      exerciseIds: ['z', 'q'],
      reasons: ['remediation', 'new'],
    });
  });

  it('хук без ответа: все расширения получают один и тот же запрос', async () => {
    const seen: unknown[] = [];
    const hook: Server = (s) =>
      s.before('session.start', (request) => void seen.push(request));
    const h = await open({ 'acme.b': hook, 'acme.a': hook });

    expect(await h.hooks.before('session.start', { now: 7 })).toBeUndefined();
    expect(seen).toEqual([{ now: 7 }, { now: 7 }]);
  });

  it('расширение, не зарегистрировавшее хук, не вызывается; без обработчиков ответа нет', async () => {
    const calls: { id: string; request: unknown }[] = [];
    const h = await open({
      'acme.a': (s) => s.before('session.start', () => {}),
      'acme.b': (s) => s.on('attempt.closed', () => {}),
      'acme.c': recording(calls, 'acme.c', (request) => request),
    });

    expect(await h.hooks.before('practice.batch', BATCH)).toEqual({
      exerciseIds: BATCH.exerciseIds,
      reasons: BATCH.reasons,
    });
    expect(calls.map(({ id }) => id)).toEqual(['acme.c']);
  });

  it('никто хук не зарегистрировал: undefined без обращения к хосту', async () => {
    const h = await open({ 'acme.a': (s) => s.on('attempt.closed', () => {}) });

    expect(await h.hooks.before('practice.batch', BATCH)).toBeUndefined();
  });

  it('отключённое расширение не вызывается', async () => {
    const calls: { id: string; request: unknown }[] = [];
    const h = await open({
      'acme.a': recording(calls, 'acme.a', (request) => request),
      'acme.b': recording(calls, 'acme.b', (request) => request),
    });
    h.policy.update({
      disabled: ['acme.a'],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
      schedulesOff: [],
    });

    await h.hooks.before('practice.batch', BATCH);

    expect(calls.map(({ id }) => id)).toEqual(['acme.b']);
  });

  it('ошибка расширения отменяет операцию: следующие не вызываются', async () => {
    const calls: { id: string; request: unknown }[] = [];
    const h = await open({
      'acme.a': (s) =>
        s.before('practice.batch', () => {
          throw new Error('no batches');
        }),
      'acme.b': recording(calls, 'acme.b', (request) => request),
    });

    expect(
      await failure(h.hooks.before('practice.batch', BATCH)),
    ).toMatchObject({
      name: 'ExtensionHookError',
      reason: 'failed',
      hook: 'practice.batch',
      extensionId: 'acme.a',
      message: 'no batches',
    });
    expect(calls).toEqual([]);
  });

  it('срок обработчика отменяет операцию: следующие не вызываются', async () => {
    const calls: { id: string; request: unknown }[] = [];
    const h = await open({
      'acme.a': (s) => s.before('practice.batch', () => new Promise(() => {})),
      'acme.b': recording(calls, 'acme.b', (request) => request),
    });
    vi.useFakeTimers();

    const outcome = failure(h.hooks.before('practice.batch', BATCH));
    await vi.advanceTimersByTimeAsync(30_100);

    expect(await outcome).toMatchObject({
      reason: 'timeout',
      extensionId: 'acme.a',
    });
    expect(calls).toEqual([]);
  });

  it('невалидный ответ отменяет операцию: следующие не вызываются', async () => {
    const calls: { id: string; request: unknown }[] = [];
    const h = await open({
      'acme.a': recording(calls, 'acme.a', () => ({
        exerciseIds: ['x'],
        reasons: [],
      })),
      'acme.b': recording(calls, 'acme.b', (request) => request),
    });

    expect(
      await failure(h.hooks.before('practice.batch', BATCH)),
    ).toMatchObject({ reason: 'invalid-result', extensionId: 'acme.a' });
    expect(calls.map(({ id }) => id)).toEqual(['acme.a']);
  });

  it('ответ, не прошедший проверку движка, — отказ того расширения, чей он: следующие не вызываются', async () => {
    const calls: { id: string; request: unknown }[] = [];
    const h = await open({
      'acme.a': recording(calls, 'acme.a', () => ({
        exerciseIds: ['x'],
        reasons: ['new'],
      })),
      'acme.b': recording(calls, 'acme.b', () => ({
        exerciseIds: ['ghost'],
        reasons: ['new'],
      })),
      'acme.c': recording(calls, 'acme.c', (request) => request),
    });
    const verify = vi.fn(({ exerciseIds }: { exerciseIds: string[] }) =>
      exerciseIds.includes('ghost') ? "unknown exercise 'ghost'" : null,
    );

    expect(
      await failure(h.hooks.before('practice.batch', BATCH, verify)),
    ).toMatchObject({
      reason: 'invalid-result',
      extensionId: 'acme.b',
      message: "unknown exercise 'ghost'",
    });
    expect(verify).toHaveBeenCalledTimes(2);
    expect(calls.map(({ id }) => id)).toEqual(['acme.a', 'acme.b']);
  });
});
