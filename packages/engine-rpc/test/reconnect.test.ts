import type { EngineEvent } from '@spirula-app/engine-contract';
import { createCapturingLogger } from '@spirula-app/testkit';
import { describe, expect, it } from 'vitest';
import { createEngineClient } from '../src/client/index.ts';
import { createDispatcher, schemas } from '../src/host/index.ts';
import { createInProcessPair } from '../src/in-process.ts';
import { createFakeEngine, deferred, tick, type Method } from './helpers.ts';

const createHost = (overrides: Record<string, Method> = {}) => {
  const fake = createFakeEngine(overrides);
  const { logger, records } = createCapturingLogger();
  const dispatcher = createDispatcher({ engine: fake.engine, schemas, logger });
  const connectClient = async (
    client: ReturnType<typeof createEngineClient>,
    id: string,
  ) => {
    const [hostSide, clientSide] = createInProcessPair();
    dispatcher.attach(hostSide, id);
    await client.attach(clientSide);
    return hostSide;
  };
  return { fake, dispatcher, records, connectClient };
};

describe('client reconnect', () => {
  it('an idempotent call is replayed once after re-attach; a non-idempotent one gets ENGINE_CLOSED', async () => {
    const hang = deferred();
    let getDueCalls = 0;
    const host = createHost({
      'practice.getDue': (async () => {
        getDueCalls += 1;
        if (getDueCalls === 1) await hang.promise; // первый раз — обрыв до ответа
        return { items: [] };
      }) as Method,
      'practice.getBatch': (async () => hang.promise) as Method,
    });
    const client = createEngineClient();
    const firstPort = await host.connectClient(client, 'w');

    const due = client.engine.practice.getDue();
    const batch = client.engine.practice.getBatch();
    await tick();
    firstPort.close(); // обрыв
    await expect(batch).rejects.toMatchObject({
      code: 'ENGINE_CLOSED',
      retryable: true,
    });

    await host.connectClient(client, 'w');
    await expect(due).resolves.toEqual({ items: [] });
    expect(getDueCalls).toBe(2);
    hang.resolve();
  });

  it('a second drop of an already replayed call rejects it', async () => {
    const hang = deferred();
    const host = createHost({
      'practice.getDue': (async () => hang.promise) as Method,
    });
    const client = createEngineClient();
    const port1 = await host.connectClient(client, 'w');
    const due = client.engine.practice.getDue();
    due.catch(() => null);
    await tick();
    port1.close();
    const port2 = await host.connectClient(client, 'w');
    await tick();
    expect(
      host.fake.calls.filter((name) => name === 'practice.getDue'),
    ).toHaveLength(2);
    port2.close();
    await expect(due).rejects.toMatchObject({ code: 'ENGINE_CLOSED' });
    hang.resolve();
  });

  it('while disconnected: idempotent calls wait for attach, others fail at once', async () => {
    const host = createHost();
    const client = createEngineClient();
    const port = await host.connectClient(client, 'w');
    port.close();
    await tick();
    await expect(client.engine.practice.startSession()).rejects.toMatchObject({
      code: 'ENGINE_CLOSED',
    });
    const info = client.engine.library.getInfo();
    await tick();
    await host.connectClient(client, 'w');
    await expect(info).resolves.toMatchObject({ method: 'library.getInfo' });
  });

  it('event subscriptions are restored on re-attach', async () => {
    const host = createHost();
    const client = createEngineClient();
    const seen: EngineEvent[] = [];
    const port = await host.connectClient(client, 'w');
    client.engine.subscribe((event) => seen.push(event));
    await tick();
    port.close();
    expect(host.fake.listenerCount()).toBe(0);
    await host.connectClient(client, 'w');
    expect(host.fake.listenerCount()).toBe(1);
    host.fake.emit({ type: 'state-rebuilt', entries: 3, ms: 1 });
    await tick();
    expect(seen).toEqual([{ type: 'state-rebuilt', entries: 3, ms: 1 }]);
  });

  it('attach rejects on a host that answers the handshake with an error', async () => {
    const [hostSide, clientSide] = createInProcessPair();
    hostSide.onMessage((message) => {
      const { id } = message as { id: string };
      hostSide.post({
        id,
        ok: false,
        error: {
          code: 'INCOMPATIBLE_CONTRACT',
          message: 'Incompatible contract version',
          retryable: false,
        },
      });
    });
    const client = createEngineClient();
    await expect(client.attach(clientSide)).rejects.toMatchObject({
      code: 'INCOMPATIBLE_CONTRACT',
    });
  });

  it('engine.close() closes only the client port and fails pending calls', async () => {
    const hang = deferred();
    const host = createHost({
      'practice.getDue': (async () => hang.promise) as Method,
    });
    const client = createEngineClient();
    await host.connectClient(client, 'w');
    const due = client.engine.practice.getDue();
    due.catch(() => null);
    await tick();
    await client.engine.close();
    await expect(due).rejects.toMatchObject({ code: 'ENGINE_CLOSED' });
    await expect(client.engine.library.getInfo()).rejects.toMatchObject({
      code: 'ENGINE_CLOSED',
    });
    hang.resolve();
  });
});
