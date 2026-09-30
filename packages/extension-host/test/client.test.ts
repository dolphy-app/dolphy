import type { MessageEndpoint } from '@lms/engine-contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCatalog } from '../src/catalog.ts';
import { createRemoteExerciseTypes } from '../src/client.ts';
import { createEndpointPair } from '../src/loopback.ts';
import type { ExtRequest, ExtResponse } from '../src/protocol.ts';
import { createLogger } from './helpers.ts';

afterEach(() => vi.useRealTimers());

const catalog = createCatalog([
  {
    id: 'acme.t',
    version: '1.0.0',
    origin: 'bundled',
    dir: '/x',
    mainPath: '/x/main.mjs',
    exerciseTypes: [
      {
        id: 'acme.t',
        specSchema: {},
        answerSchema: {},
        element: 'acme-t-answer',
        rendererUrl: 'lms-ext://acme.t/view.mjs',
      },
    ],
    themes: [],
    markdownRenderers: [],
    gradePolicies: [],
  },
]);

const gradeRequest = {
  type: 'acme.t',
  exerciseId: 'e',
  spec: {},
  answer: 'x',
  timeoutMs: 100,
  authorMode: false,
};

const setup = (options: { restart?: () => void } = {}) => {
  const client = createRemoteExerciseTypes({
    catalog,
    logger: createLogger(),
    graceMs: 50,
    connectTimeoutMs: 500,
    ...options,
  });
  const [engineSide, hostSide] = createEndpointPair();
  const requests: ExtRequest[] = [];
  hostSide.onMessage((message) => requests.push(message as ExtRequest));
  return { client, engineSide, hostSide, requests };
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('createRemoteExerciseTypes', () => {
  it('ответ хоста превращается в RawVerdict, durationMs замеряет клиент', async () => {
    const { client, engineSide, hostSide, requests } = setup();
    hostSide.onMessage((message) => {
      const { id } = message as ExtRequest;
      hostSide.post({
        id,
        ok: true,
        result: { outcome: 'failed', reason: 'mismatch', detail: 'd', data: 1 },
      } satisfies ExtResponse);
    });
    client.attach(engineSide);
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
    const { client, engineSide, hostSide } = setup();
    client.attach(engineSide);
    const pending = client.grade(gradeRequest);
    await flush();
    hostSide.close();
    expect(await pending).toMatchObject({
      outcome: 'error',
      reason: 'worker_crash',
    });
  });

  it('закрытие endpoint во время project → ExerciseTypeError host-down', async () => {
    const { client, engineSide, hostSide } = setup();
    client.attach(engineSide);
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
    const { client, engineSide } = setup({ restart });
    client.attach(engineSide);
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
    const client = createRemoteExerciseTypes({
      catalog,
      logger: createLogger(),
      projectTimeoutMs: 300,
      restart,
    });
    client.attach(createEndpointPair()[0]);
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
    const { client, engineSide, hostSide } = setup();
    hostSide.onMessage((message) => {
      hostSide.post({
        id: (message as ExtRequest).id,
        ok: true,
        result: { outcome: 'passed' },
      });
    });
    const pending = client.grade(gradeRequest);
    await flush();
    client.attach(engineSide);
    expect(await pending).toMatchObject({ outcome: 'passed' });
  });

  it('без attach дольше connectTimeoutMs → host-down / worker_crash', async () => {
    vi.useFakeTimers();
    const client = createRemoteExerciseTypes({
      catalog,
      logger: createLogger(),
      connectTimeoutMs: 1000,
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
    first.client.attach(first.engineSide);
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
    first.client.attach(nextEngine);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(await pending).toMatchObject({ reason: 'worker_crash' });
    expect(await first.client.grade(gradeRequest)).toMatchObject({
      outcome: 'passed',
    });
  });

  it('ответ ok:false: error/internal, feedback только в authorMode', async () => {
    const { client, engineSide, hostSide } = setup();
    hostSide.onMessage((message) => {
      hostSide.post({
        id: (message as ExtRequest).id,
        ok: false,
        error: { cause: 'handler-failed', message: 'kaboom' },
      } satisfies ExtResponse);
    });
    client.attach(engineSide);
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
    const { client, engineSide } = setup();
    client.attach(engineSide);
    const pending = client.grade(gradeRequest);
    await flush();
    await client.close();
    expect(await pending).toMatchObject({ reason: 'worker_crash' });
    await expect(
      client.project({ type: 'acme.t', exerciseId: 'e', spec: {} }),
    ).rejects.toMatchObject({ cause: 'host-down' });
  });

  it('сообщение, не являющееся ответом, игнорируется', async () => {
    const { client, engineSide, hostSide } = setup();
    hostSide.onMessage((message) => {
      hostSide.post('garbage');
      hostSide.post({
        id: (message as ExtRequest).id,
        ok: true,
        result: { outcome: 'passed' },
      });
    });
    client.attach(engineSide);
    expect(await client.grade(gradeRequest)).toMatchObject({
      outcome: 'passed',
    });
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
