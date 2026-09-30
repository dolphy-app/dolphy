import { describe, expect, it } from 'vitest';
import { createEngineClient } from '../src/client/index.ts';
import { createDispatcher, schemas } from '../src/host/index.ts';
import { createInProcessPair } from '../src/in-process.ts';
import { createCapturingLogger } from '@dolphy-app/testkit';
import { createFakeEngine, type Method } from './helpers.ts';

const leaky = (async () => ({ callback: () => 1 })) as Method;

const setup = async (verifyCloneable: boolean) => {
  const fake = createFakeEngine({ 'library.getInfo': leaky });
  const { logger, records } = createCapturingLogger();
  const dispatcher = createDispatcher({
    engine: fake.engine,
    schemas,
    logger,
    verifyCloneable,
  });
  const [hostSide, clientSide] = createInProcessPair();
  dispatcher.attach(hostSide, 'w');
  const client = createEngineClient();
  await client.attach(clientSide);
  return { client, records };
};

describe('structured clone limits', () => {
  it('in-process pair rejects a function in a message with DataCloneError', () => {
    const [a] = createInProcessPair();
    expect(() => a.post({ f: () => 1 })).toThrowError(
      expect.objectContaining({ name: 'DataCloneError' }) as Error,
    );
  });

  it('verifyCloneable catches a non-cloneable result on the host', async () => {
    const { client, records } = await setup(true);
    await expect(client.engine.library.getInfo()).rejects.toMatchObject({
      code: 'INTERNAL',
    });
    expect(records.some((record) => record.level === 'error')).toBe(true);
  });

  it('without verifyCloneable the failed post still yields an INTERNAL response', async () => {
    const { client, records } = await setup(false);
    await expect(client.engine.library.getInfo()).rejects.toMatchObject({
      code: 'INTERNAL',
      details: { method: 'library.getInfo', cause: 'not-cloneable' },
    });
    expect(records.some((record) => record.level === 'error')).toBe(true);
  });

  it('a non-cloneable argument fails the call on the client without hanging', async () => {
    const { client } = await setup(false);
    await expect(
      client.engine.library.readAsset({ unitId: 'u', path: () => 1 } as never),
    ).rejects.toMatchObject({ name: 'DataCloneError' });
  });
});
