import type { RpcContract } from '@dolphy-app/extension-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ServerContext } from '@dolphy-app/extension-api';
import { candidateOf, deferred } from './helpers.ts';
import { createHarness } from './state-harness.ts';
import type { Harness } from './state-harness.ts';

const ID = 'acme.rpc';
const HELLO = 'greeting.say-hello';

const hello: RpcContract<{ who: string }, { greeting: string }> = {
  name: HELLO,
  input: z.object({ who: z.string().min(1) }),
  output: z.object({ greeting: z.string() }),
};

let harness: Harness | null = null;
afterEach(async () => {
  vi.useRealTimers();
  await harness?.close();
  harness = null;
});

const open = async (
  server: (s: ServerContext) => unknown,
  options: Partial<Parameters<typeof createHarness>[0]> = {},
): Promise<Harness> => {
  harness = await createHarness({
    candidates: [candidateOf(ID)],
    modules: { [ID]: { server: (s) => void server(s) } },
    ...options,
  });
  return harness;
};

const greeting = (s: ServerContext) =>
  s.handle(hello, ({ who }) => ({ greeting: `hello ${who}` }));

describe('server.handle: вызов через хост', () => {
  it('вход и выход проходят схемы, результат возвращается как есть', async () => {
    const h = await open(greeting);

    expect(await h.rpc.invoke(ID, HELLO, { who: 'Ann' })).toEqual({
      greeting: 'hello Ann',
    });
  });

  it('преобразование входной схемы применяется: обработчик получает разобранный вход', async () => {
    const seen: unknown[] = [];
    const h = await open((s) =>
      s.handle(
        {
          name: 'math.double',
          input: z.object({ n: z.string().transform(Number) }),
          output: z.number(),
        },
        ({ n }) => {
          seen.push(n);
          return n * 2;
        },
      ),
    );

    expect(await h.rpc.invoke(ID, 'math.double', { n: '21' })).toBe(42);
    expect(seen).toEqual([21]);
  });

  it('вход не по схеме — invalid-input с путём поля, обработчик не вызывается', async () => {
    const handler = vi.fn(() => ({ greeting: 'x' }));
    const h = await open((s) => s.handle(hello, handler));

    await expect(h.rpc.invoke(ID, HELLO, { who: '' })).rejects.toMatchObject({
      name: 'ExtensionRpcError',
      cause: 'invalid-input',
      message: expect.stringContaining('who'),
    });
    await expect(h.rpc.invoke(ID, HELLO, undefined)).rejects.toMatchObject({
      cause: 'invalid-input',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('результат не по схеме — invalid-result', async () => {
    const h = await open((s) =>
      s.handle(hello, () => ({ greeting: 5 }) as never),
    );

    await expect(h.rpc.invoke(ID, HELLO, { who: 'Ann' })).rejects.toMatchObject(
      { cause: 'invalid-result', message: expect.stringContaining('greeting') },
    );
  });

  it('результат, который схема пропустила, но это не JSON — invalid-result', async () => {
    const h = await open((s) =>
      s.handle(
        { name: 'raw.fn', input: z.unknown(), output: z.unknown() },
        () => () => 1,
      ),
    );

    await expect(h.rpc.invoke(ID, 'raw.fn', null)).rejects.toMatchObject({
      cause: 'invalid-result',
      message: expect.stringContaining('not JSON'),
    });
  });

  it('контракт с void: пустой результат доходит как undefined', async () => {
    const h = await open((s) =>
      s.handle(
        { name: 'ping.send', input: z.void(), output: z.void() },
        () => {},
      ),
    );

    expect(await h.rpc.invoke(ID, 'ping.send', undefined)).toBeUndefined();
  });

  it('ошибка обработчика доходит с сообщением: handler-failed', async () => {
    const h = await open((s) =>
      s.handle(hello, () => {
        throw new Error('no greeting today');
      }),
    );

    await expect(h.rpc.invoke(ID, HELLO, { who: 'Ann' })).rejects.toMatchObject(
      {
        name: 'ExtensionRpcError',
        cause: 'handler-failed',
        message: 'no greeting today',
        extensionId: ID,
        rpcName: HELLO,
      },
    );
  });

  it('асинхронный отказ обработчика тоже handler-failed', async () => {
    const h = await open((s) =>
      s.handle(hello, async () => {
        throw new Error('later');
      }),
    );

    await expect(h.rpc.invoke(ID, HELLO, { who: 'Ann' })).rejects.toMatchObject(
      { cause: 'handler-failed', message: 'later' },
    );
  });

  it('обработчик, не уложившийся в 10 с, — timeout; хост не перезапускается, соседние вызовы работают', async () => {
    const restart = vi.fn();
    const h = await open(
      (s) => {
        greeting(s);
        s.handle(
          { name: 'slow.hang', input: z.unknown(), output: z.unknown() },
          () => new Promise<void>(() => {}),
        );
      },
      { restart },
    );
    vi.useFakeTimers();

    const outcome = h.rpc.invoke(ID, 'slow.hang', null).then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(9900);
    expect(await h.rpc.invoke(ID, HELLO, { who: 'Ann' })).toEqual({
      greeting: 'hello Ann',
    });
    await vi.advanceTimersByTimeAsync(200);

    expect(await outcome).toMatchObject({
      name: 'ExtensionRpcError',
      cause: 'timeout',
    });
    expect(restart).not.toHaveBeenCalled();
  });

  it('вызовы идут одновременно: медленный не задерживает быстрый', async () => {
    const gate = deferred();
    const h = await open((s) => {
      greeting(s);
      s.handle(
        { name: 'slow.wait', input: z.unknown(), output: z.string() },
        async () => {
          await gate.promise;
          return 'slow';
        },
      );
    });

    const slow = h.rpc.invoke(ID, 'slow.wait', null);
    expect(await h.rpc.invoke(ID, HELLO, { who: 'Ann' })).toEqual({
      greeting: 'hello Ann',
    });
    gate.resolve();

    expect(await slow).toBe('slow');
  });

  it('неизвестное имя и неизвестное расширение — unknown-rpc', async () => {
    const h = await open(greeting);

    await expect(h.rpc.invoke(ID, 'greeting.other', {})).rejects.toMatchObject({
      cause: 'unknown-rpc',
      message: expect.stringContaining('greeting.other'),
    });
    await expect(
      h.rpc.invoke('acme.ghost', HELLO, { who: 'Ann' }),
    ).rejects.toMatchObject({ cause: 'unknown-rpc' });
  });

  it('dispose снимает обработчик: следующий вызов — unknown-rpc', async () => {
    let registration: { dispose(): void | Promise<void> } | undefined;
    const h = await open((s) => {
      registration = greeting(s);
    });
    expect(await h.rpc.invoke(ID, HELLO, { who: 'Ann' })).toEqual({
      greeting: 'hello Ann',
    });

    await registration?.dispose();

    await expect(h.rpc.invoke(ID, HELLO, { who: 'Ann' })).rejects.toMatchObject(
      { cause: 'unknown-rpc' },
    );
  });

  it('server, бросивший ошибку, оставляет расширение без обработчиков', async () => {
    const h = await open((s) => {
      greeting(s);
      throw new Error('boom on start');
    });

    await expect(h.rpc.invoke(ID, HELLO, { who: 'Ann' })).rejects.toMatchObject(
      { cause: 'unknown-rpc' },
    );
  });

  it('имена обработчиков попадают в регистрацию расширения', async () => {
    const h = await open((s) => {
      greeting(s);
      s.handle(
        { name: 'math.double', input: z.unknown(), output: z.unknown() },
        () => 0,
      );
    });

    const { rpcs } = h.discovery.get().extensions[0] ?? { rpcs: [] };
    expect(rpcs).toEqual([HELLO, 'math.double']);
  });
});
