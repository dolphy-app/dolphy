import type { ExtensionTransfers } from '@dolphy-app/engine/ports';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHostChannel } from '../src/channel.ts';
import { createRemoteExtensionTransfers } from '../src/client.ts';
import { createEndpointPair } from '../src/loopback.ts';
import type { ExtRequest } from '../src/protocol.ts';
import { createLogger } from './helpers.ts';

afterEach(() => vi.useRealTimers());

const ID = 'acme.csv';

type Reply =
  | { ok: true; result: unknown }
  | { ok: false; error: { cause: string; message: string } };

/** Хост, которого тест заменяет сам: отвечает на запросы заданным ответом или молчит. */
const setup = (reply: Reply | null, deadlineMs?: number) => {
  const restart = vi.fn();
  const logger = createLogger();
  const channel = createHostChannel({ logger, restart });
  const [engineSide, hostSide] = createEndpointPair();
  const requests: ExtRequest[] = [];
  hostSide.onMessage((message) => {
    const request = message as ExtRequest;
    requests.push(request);
    if (reply !== null) hostSide.post({ id: request.id, ...reply });
  });
  channel.attach(engineSide);
  const transfers = createRemoteExtensionTransfers({
    channel,
    logger,
    ...(deadlineMs !== undefined && { deadlineMs }),
  });
  return { transfers, restart, requests };
};

const runImport = (transfers: ExtensionTransfers) =>
  transfers.runImporter(ID, `${ID}.in`, { name: 'a.csv', text: 'x' });

const runExport = (transfers: ExtensionTransfers) =>
  transfers.runExporter(ID, `${ID}.out`, { scope: 'progress' });

describe('createRemoteExtensionTransfers', () => {
  it('отправляет расширение, запись, режим исполнения и файл; для экспорта — вход по области', async () => {
    // ответ не важен: здесь сверяется только то, что ушло хосту
    const { transfers, requests } = setup({ ok: true, result: null });
    const bytes = Uint8Array.of(1, 2);

    await transfers
      .runImporter(ID, `${ID}.in`, { name: 'a.bin', bytes })
      .catch(() => {});
    await runImport(transfers).catch(() => {});
    await transfers
      .runExporter(ID, `${ID}.out`, {
        scope: 'course',
        courseId: 'c',
        title: 'T',
        files: { 'a.md': 'x' },
      })
      .catch(() => {});

    expect(requests.map(({ method, params }) => [method, params])).toEqual([
      [
        'runImporter',
        {
          extensionId: ID,
          importerId: `${ID}.in`,
          name: 'a.bin',
          bytes,
        },
      ],
      [
        'runImporter',
        {
          extensionId: ID,
          importerId: `${ID}.in`,
          name: 'a.csv',
          text: 'x',
        },
      ],
      [
        'runExporter',
        {
          extensionId: ID,
          exporterId: `${ID}.out`,
          input: {
            scope: 'course',
            courseId: 'c',
            title: 'T',
            files: { 'a.md': 'x' },
          },
        },
      ],
    ]);
  });

  it('допустимые результаты проходят: каталог, файл текстом и файл байтами', async () => {
    expect(
      await runImport(
        setup({ ok: true, result: { files: { 'a/b.md': 'x' } } }).transfers,
      ),
    ).toEqual({ files: { 'a/b.md': 'x' } });
    expect(
      await runExport(
        setup({ ok: true, result: { filename: 'a.csv', text: 'x' } }).transfers,
      ),
    ).toEqual({ filename: 'a.csv', text: 'x' });
    expect(
      await runExport(
        setup({
          ok: true,
          result: { filename: 'a.bin', bytes: Uint8Array.of(1) },
        }).transfers,
      ),
    ).toEqual({ filename: 'a.bin', bytes: Uint8Array.of(1) });
  });

  it.each([
    ['каталог с путём ../x', { files: { '../x': '1' } }, true],
    ['каталог с A.md и a.md', { files: { 'A.md': '1', 'a.md': '2' } }, true],
    ['не объект', 'files', true],
    ['файл с путём в имени', { filename: 'a/b', text: '' }, false],
    ['файл без содержимого', { filename: 'a' }, false],
    [
      'файл и с text, и с bytes',
      { filename: 'a', text: '', bytes: Uint8Array.of() },
      false,
    ],
  ])(
    'ответ недоверенного хоста отвергается (%s): invalid-result',
    async (_name, result, forImport) => {
      const { transfers } = setup({ ok: true, result });

      await expect(
        forImport ? runImport(transfers) : runExport(transfers),
      ).rejects.toMatchObject({
        name: 'ExtensionTransferError',
        cause: 'invalid-result',
        kind: forImport ? 'import' : 'export',
        extensionId: ID,
      });
    },
  );

  it.each([
    ['unknown-importer', 'unknown-importer'],
    ['unknown-exporter', 'unknown-exporter'],
    ['handler-failed', 'handler-failed'],
    ['invalid-result', 'invalid-result'],
    ['replaced', 'replaced'],
    ['handler-timeout', 'timeout'],
    ['activation-failed', 'handler-failed'],
    ['activation-timeout', 'handler-failed'],
    ['ipc-size', 'handler-failed'],
    ['unknown-command', 'handler-failed'],
  ])('причина хоста %s -> %s', async (cause, expected) => {
    const { transfers } = setup({
      ok: false,
      error: { cause, message: 'text from the extension' },
    });

    await expect(runImport(transfers)).rejects.toMatchObject({
      cause: expected,
      id: `${ID}.in`,
      message: 'text from the extension',
    });
  });

  it('хост не ответил к дедлайну клиента: timeout, перезапуск хоста не взводится', async () => {
    vi.useFakeTimers();
    const { transfers, restart } = setup(null, 5000);

    const outcome = runImport(transfers).then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(4900);
    expect(restart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);

    expect(await outcome).toMatchObject({ cause: 'timeout' });
    expect(restart).not.toHaveBeenCalled();
  });

  it('срок клиента по умолчанию — 34 с, больше срока обработчика (30 с) и раннера (32 с)', async () => {
    vi.useFakeTimers();
    const { transfers } = setup(null);

    let settled = false;
    void runExport(transfers).catch(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(33_900);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(settled).toBe(true);
  });

  it('хост не подключён — host-down', async () => {
    vi.useFakeTimers();
    const logger = createLogger();
    const channel = createHostChannel({ logger });
    await channel.close();
    const transfers = createRemoteExtensionTransfers({
      channel,
      logger,
    });

    await expect(runImport(transfers)).rejects.toMatchObject({
      cause: 'host-down',
    });
  });
});
