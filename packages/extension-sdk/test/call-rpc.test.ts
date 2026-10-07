import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ExtensionEngine } from '@dolphy-app/engine-contract';
import { callRpc, defineRpc } from '../src/index.ts';

const sayHello = defineRpc({
  name: 'greeting.say-hello',
  input: z.object({ name: z.string() }),
  output: z.object({ text: z.string() }),
});

const engineWith = (
  invokeRpc: (request: unknown) => Promise<unknown>,
): ExtensionEngine => {
  // only `extensions.invokeRpc` is read by callRpc
  const engine = { extensions: { invokeRpc } };
  return engine as unknown as ExtensionEngine;
};

describe('callRpc', () => {
  it('sends the validated input to the extension and returns the validated answer', async () => {
    const requests: unknown[] = [];
    const engine = engineWith(async (request) => {
      requests.push(request);
      return { text: 'Hello, Ada' };
    });

    await expect(
      callRpc({ engine, extensionId: 'acme.hello' }, sayHello, { name: 'Ada' }),
    ).resolves.toEqual({ text: 'Hello, Ada' });
    expect(requests).toEqual([
      {
        extensionId: 'acme.hello',
        name: 'greeting.say-hello',
        input: { name: 'Ada' },
      },
    ]);
  });

  it('refuses a bad input without calling the engine', async () => {
    let calls = 0;
    const engine = engineWith(async () => {
      calls += 1;
      return { text: 'x' };
    });
    const input = { name: 1 } as unknown as { name: string };

    await expect(
      callRpc({ engine, extensionId: 'acme.hello' }, sayHello, input),
    ).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it('rejects an answer that breaks the output schema and passes engine errors on', async () => {
    const bad = engineWith(async () => ({ text: 1 }));
    const failing = engineWith(async () => {
      throw new Error('server is down');
    });

    await expect(
      callRpc({ engine: bad, extensionId: 'a.b' }, sayHello, { name: 'A' }),
    ).rejects.toThrow();
    await expect(
      callRpc({ engine: failing, extensionId: 'a.b' }, sayHello, { name: 'A' }),
    ).rejects.toThrow('server is down');
  });
});
