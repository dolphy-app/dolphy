import type { MessageEndpoint } from '@spirula-app/engine-contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCatalog } from '../src/catalog.ts';
import type { ResolvedExtension } from '../src/discover.ts';
import { createHostChannel } from '../src/channel.ts';
import {
  createRemoteExerciseTypes,
  createRemoteGradePolicies,
} from '../src/client.ts';
import { createEndpointPair } from '../src/loopback.ts';
import {
  createAllTrustedPolicy,
  createExtensionPolicy,
} from '../src/policy.ts';
import type { ExtRequest, ExtResponse } from '../src/protocol.ts';
import { createLogger } from './helpers.ts';

afterEach(() => vi.useRealTimers());

const resolved: ResolvedExtension[] = [
  {
    id: 'acme.t',
    version: '1.0.0',
    origin: 'user',
    dir: '/x',
    mainPath: '/x/main.mjs',
    permissions: [],
    name: null,
    description: null,
    author: null,
    platforms: [],
    minAppVersion: null,
    install: null,
    exerciseTypes: [
      {
        id: 'acme.t',
        specSchema: {},
        answerSchema: {},
        element: 'acme-t-answer',
        rendererUrl: 'spirula-ext://acme.t/view.mjs',
      },
    ],
    themes: [],
    markdownRenderers: [],
    gradePolicies: [{ id: 'acme.t.gen', label: 'Generous' }],
  },
];
const catalog = createCatalog(resolved, createAllTrustedPolicy());

const gradeRequest = {
  type: 'acme.t',
  exerciseId: 'e',
  spec: {},
  answer: 'x',
  timeoutMs: 100,
  authorMode: false,
};

const setup = (
  options: {
    restart?: () => void;
    policy?: ReturnType<typeof createExtensionPolicy>;
  } = {},
) => {
  const { policy = createAllTrustedPolicy(), ...channelOptions } = options;
  const logger = createLogger();
  const channel = createHostChannel({
    logger,
    connectTimeoutMs: 500,
    ...channelOptions,
  });
  const client = createRemoteExerciseTypes({
    channel,
    catalog,
    policy,
    logger,
    graceMs: 50,
  });
  const policies = createRemoteGradePolicies({
    channel,
    catalog,
    policy,
    logger,
    deadlineMs: 100,
  });
  const [engineSide, hostSide] = createEndpointPair();
  const requests: ExtRequest[] = [];
  hostSide.onMessage((message) => requests.push(message as ExtRequest));
  return { client, policies, channel, engineSide, hostSide, requests };
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('createRemoteExerciseTypes', () => {
  it('ответ хоста превращается в RawVerdict, durationMs замеряет клиент', async () => {
    const { client, channel, engineSide, hostSide, requests } = setup();
    hostSide.onMessage((message) => {
      const { id } = message as ExtRequest;
      hostSide.post({
        id,
        ok: true,
        result: { outcome: 'failed', reason: 'mismatch', detail: 'd', data: 1 },
      } satisfies ExtResponse);
    });
    channel.attach(engineSide);
    const verdict = await client.grade(gradeRequest);
    expect(verdict).toMatchObject({
      outcome: 'failed',
      reason: 'mismatch',
      detail: 'd',
      data: 1,
    });
    expect(typeof verdict.durationMs).toBe('number');
    expect(requests[0]).toMatchObject({ method: 'grade', id: '0' });
  });

  it('закрытие endpoint во время grade → error/worker_crash', async () => {
    const { client, channel, engineSide, hostSide } = setup();
    channel.attach(engineSide);
    const pending = client.grade(gradeRequest);
    await flush();
    hostSide.close();
    expect(await pending).toMatchObject({
      outcome: 'error',
      reason: 'worker_crash',
    });
  });

  it('закрытие endpoint во время project → ExerciseTypeError host-down', async () => {
    const { client, channel, engineSide, hostSide } = setup();
    channel.attach(engineSide);
    const pending = client.project({
      type: 'acme.t',
      exerciseId: 'e',
      spec: {},
    });
    await flush();
    hostSide.close();
    await expect(pending).rejects.toMatchObject({ cause: 'host-down' });
  });

  it('зависший обработчик → error/timeout и вызов restart', async () => {
    vi.useFakeTimers();
    const restart = vi.fn();
    const { client, channel, engineSide } = setup({ restart });
    channel.attach(engineSide);
    const pending = client.grade(gradeRequest);
    await vi.advanceTimersByTimeAsync(149);
    expect(restart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({
      outcome: 'error',
      reason: 'timeout',
    });
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('project по таймауту → ExerciseTypeError timeout', async () => {
    vi.useFakeTimers();
    const restart = vi.fn();
    const logger = createLogger();
    const channel = createHostChannel({ logger, restart });
    const client = createRemoteExerciseTypes({
      channel,
      catalog,
      policy: createAllTrustedPolicy(),
      logger,
      projectTimeoutMs: 300,
    });
    channel.attach(createEndpointPair()[0]);
    const pending = client.project({
      type: 'acme.t',
      exerciseId: 'e',
      spec: {},
    });
    const assertion = expect(pending).rejects.toMatchObject({
      cause: 'timeout',
    });
    await vi.advanceTimersByTimeAsync(300);
    await assertion;
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('запрос до attach ждёт и выполняется после attach', async () => {
    const { client, channel, engineSide, hostSide } = setup();
    hostSide.onMessage((message) => {
      hostSide.post({
        id: (message as ExtRequest).id,
        ok: true,
        result: { outcome: 'passed' },
      });
    });
    const pending = client.grade(gradeRequest);
    await flush();
    channel.attach(engineSide);
    expect(await pending).toMatchObject({ outcome: 'passed' });
  });

  it('без attach дольше connectTimeoutMs → host-down / worker_crash', async () => {
    vi.useFakeTimers();
    const logger = createLogger();
    const client = createRemoteExerciseTypes({
      channel: createHostChannel({ logger, connectTimeoutMs: 1000 }),
      catalog,
      policy: createAllTrustedPolicy(),
      logger,
    });
    const project = client.project({
      type: 'acme.t',
      exerciseId: 'e',
      spec: {},
    });
    const projectAssertion = expect(project).rejects.toMatchObject({
      cause: 'host-down',
    });
    const grade = client.grade(gradeRequest);
    await vi.advanceTimersByTimeAsync(1000);
    await projectAssertion;
    expect(await grade).toMatchObject({
      outcome: 'error',
      reason: 'worker_crash',
    });
  });

  it('attach нового endpoint закрывает старый и обрывает его запросы', async () => {
    const first = setup();
    const onClose = vi.fn();
    first.engineSide.onClose(onClose);
    first.channel.attach(first.engineSide);
    const pending = first.client.grade(gradeRequest);
    await flush();
    const [nextEngine, nextHost] = createEndpointPair();
    nextHost.onMessage((message) => {
      nextHost.post({
        id: (message as ExtRequest).id,
        ok: true,
        result: { outcome: 'passed' },
      });
    });
    first.channel.attach(nextEngine);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(await pending).toMatchObject({ reason: 'worker_crash' });
    expect(await first.client.grade(gradeRequest)).toMatchObject({
      outcome: 'passed',
    });
  });

  it('ответ ok:false: error/internal, feedback только в authorMode', async () => {
    const { client, channel, engineSide, hostSide } = setup();
    hostSide.onMessage((message) => {
      hostSide.post({
        id: (message as ExtRequest).id,
        ok: false,
        error: { cause: 'handler-failed', message: 'kaboom' },
      } satisfies ExtResponse);
    });
    channel.attach(engineSide);
    const learner = await client.grade(gradeRequest);
    expect(learner).toMatchObject({ outcome: 'error', reason: 'internal' });
    expect(learner).not.toHaveProperty('feedback');
    expect(
      await client.grade({ ...gradeRequest, authorMode: true }),
    ).toMatchObject({ feedback: 'kaboom' });
    await expect(
      client.referenceAnswer({ type: 'acme.t', exerciseId: 'e', spec: {} }),
    ).rejects.toMatchObject({ cause: 'handler-failed', message: 'kaboom' });
  });

  it('close() закрывает endpoint и завершает ожидающие вызовы', async () => {
    const { client, channel, engineSide } = setup();
    channel.attach(engineSide);
    const pending = client.grade(gradeRequest);
    await flush();
    await client.close();
    expect(await pending).toMatchObject({ reason: 'worker_crash' });
    await expect(
      client.project({ type: 'acme.t', exerciseId: 'e', spec: {} }),
    ).rejects.toMatchObject({ cause: 'host-down' });
  });

  it('сообщение, не являющееся ответом, игнорируется', async () => {
    const { client, channel, engineSide, hostSide } = setup();
    hostSide.onMessage((message) => {
      hostSide.post('garbage');
      hostSide.post({
        id: (message as ExtRequest).id,
        ok: true,
        result: { outcome: 'passed' },
      });
    });
    channel.attach(engineSide);
    expect(await client.grade(gradeRequest)).toMatchObject({
      outcome: 'passed',
    });
  });
});

describe('createRemoteGradePolicies', () => {
  const base = { attemptId: 'a', attemptsUsed: 1, durationMs: 1 };
  const input = {
    verdicts: [
      { ...base, outcome: 'failed' as const, reason: 'mismatch' },
      { ...base, outcome: 'passed' as const },
    ],
    gaveUp: false,
  };

  it('list отдаёт правила из каталога', () => {
    const { policies } = setup();
    expect(policies.list()).toEqual([
      { id: 'acme.t.gen', label: 'Generous', extensionId: 'acme.t' },
    ]);
  });

  it('передаёт вердикты как {outcome, reason?} и возвращает оценку', async () => {
    const { policies, channel, engineSide, hostSide, requests } = setup();
    hostSide.onMessage((message) => {
      hostSide.post({
        id: (message as ExtRequest).id,
        ok: true,
        result: 5,
      } satisfies ExtResponse);
    });
    channel.attach(engineSide);
    const verdicts = [
      {
        outcome: 'failed' as const,
        reason: 'mismatch',
        attemptId: 'a',
        attemptsUsed: 1,
        durationMs: 3,
      },
      {
        outcome: 'passed' as const,
        attemptId: 'a',
        attemptsUsed: 2,
        durationMs: 4,
      },
    ];
    expect(
      await policies.evaluate('acme.t.gen', { verdicts, gaveUp: false }),
    ).toBe(5);
    expect(requests[0]).toMatchObject({
      method: 'gradePolicy',
      params: {
        policyId: 'acme.t.gen',
        verdicts: [
          { outcome: 'failed', reason: 'mismatch' },
          { outcome: 'passed' },
        ],
        gaveUp: false,
      },
    });
  });

  it('null проходит как есть', async () => {
    const { policies, channel, engineSide, hostSide } = setup();
    hostSide.onMessage((message) => {
      hostSide.post({ id: (message as ExtRequest).id, ok: true, result: null });
    });
    channel.attach(engineSide);
    expect(
      await policies.evaluate('acme.t.gen', { verdicts: [], gaveUp: false }),
    ).toBeNull();
  });

  it.each([0, 6, 2.5, 'x'])('результат %j → invalid-result', async (result) => {
    const { policies, channel, engineSide, hostSide } = setup();
    hostSide.onMessage((message) => {
      hostSide.post({ id: (message as ExtRequest).id, ok: true, result });
    });
    channel.attach(engineSide);
    await expect(
      policies.evaluate('acme.t.gen', { verdicts: [], gaveUp: false }),
    ).rejects.toMatchObject({ cause: 'invalid-result' });
  });

  it('ok:false → handler-failed / unknown-policy', async () => {
    const { policies, channel, engineSide, hostSide } = setup();
    let cause = 'handler-failed';
    hostSide.onMessage((message) => {
      hostSide.post({
        id: (message as ExtRequest).id,
        ok: false,
        error: { cause, message: 'nope' },
      } as ExtResponse);
    });
    channel.attach(engineSide);
    await expect(
      policies.evaluate('acme.t.gen', { verdicts: [], gaveUp: false }),
    ).rejects.toMatchObject({ cause: 'handler-failed', message: 'nope' });
    cause = 'unknown-policy';
    await expect(
      policies.evaluate('acme.t.gen', { verdicts: [], gaveUp: false }),
    ).rejects.toMatchObject({ cause: 'unknown-policy' });
  });

  it('зависшее правило → timeout и вызов restart', async () => {
    vi.useFakeTimers();
    const restart = vi.fn();
    const { policies, channel, engineSide } = setup({ restart });
    channel.attach(engineSide);
    const assertion = expect(
      policies.evaluate('acme.t.gen', input),
    ).rejects.toMatchObject({ cause: 'timeout' });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('закрытие endpoint и отсутствие хоста → host-down', async () => {
    const { policies, channel, engineSide, hostSide } = setup();
    channel.attach(engineSide);
    const pending = policies.evaluate('acme.t.gen', input);
    await flush();
    hostSide.close();
    await expect(pending).rejects.toMatchObject({ cause: 'host-down' });

    vi.useFakeTimers();
    const lonely = setup();
    const assertion = expect(
      lonely.policies.evaluate('acme.t.gen', input),
    ).rejects.toMatchObject({ cause: 'host-down' });
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });
});

describe('createEndpointPair', () => {
  it('доставляет клон и закрывается идемпотентно', async () => {
    const [a, b] = createEndpointPair();
    const received: unknown[] = [];
    const closed = vi.fn();
    b.onMessage((m) => received.push(m));
    a.onClose(closed);
    b.onClose(closed);
    const message = { n: 1 };
    a.post(message);
    await flush();
    expect(received).toEqual([{ n: 1 }]);
    expect(received[0]).not.toBe(message);
    (a as MessageEndpoint).close();
    a.close();
    expect(closed).toHaveBeenCalledTimes(2);
  });
});

describe('isolated в запросах', () => {
  const answering = (
    hostSide: MessageEndpoint,
    result: unknown = { outcome: 'passed' },
  ) =>
    hostSide.onMessage((message) => {
      hostSide.post({ id: (message as ExtRequest).id, ok: true, result });
    });

  it('каждый запрос несёт режим владельца, вычисленный при вызове', async () => {
    const policy = createExtensionPolicy({ extensions: resolved });
    const { client, policies, channel, engineSide, hostSide, requests } = setup(
      { policy },
    );
    answering(hostSide, null);
    channel.attach(engineSide);
    const call = async () => {
      requests.length = 0;
      await client.grade(gradeRequest);
      await policies.evaluate('acme.t.gen', { verdicts: [], gaveUp: false });
      return requests.map(
        ({ params }) => (params as { isolated: boolean }).isolated,
      );
    };
    expect(await call()).toEqual([true, true]);
    policy.update({ disabled: [], trusted: ['acme.t'], checkUpdates: true });
    expect(await call()).toEqual([false, false]);
  });

  it('project и referenceAnswer тоже несут isolated; неизвестный вид — изолирован', async () => {
    const policy = createExtensionPolicy({ extensions: resolved });
    const { client, channel, engineSide, hostSide, requests } = setup({
      policy,
    });
    answering(hostSide, { found: false });
    channel.attach(engineSide);
    await client.project({ type: 'acme.t', exerciseId: 'e', spec: {} });
    await client.referenceAnswer({ type: 'acme.t', exerciseId: 'e', spec: {} });
    await client.project({ type: 'gone', exerciseId: 'e', spec: {} });
    expect(
      requests.map(({ method, params }) => [
        method,
        (params as { isolated: boolean }).isolated,
      ]),
    ).toEqual([
      ['project', true],
      ['referenceAnswer', true],
      ['project', true],
    ]);
  });
});
