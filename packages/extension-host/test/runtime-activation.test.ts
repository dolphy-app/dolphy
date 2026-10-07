import { EMPTY_SERVER_REGISTRATION } from '@dolphy-app/extension-api';
import type {
  CommandHandler,
  ServerContext,
  ServerEntry,
} from '@dolphy-app/extension-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionCandidate } from '../src/discover.ts';
import type {
  ExtRequest,
  ExtResponse,
  ReplaceExtensionsResult,
} from '../src/protocol.ts';
import {
  ACTIVATION_TIMEOUT_MS,
  createExtensionRuntime,
} from '../src/runtime.ts';
import type { ExtensionRuntime, ServerModule } from '../src/runtime.ts';
import { candidateOf, createLogger, nullLibrary } from './helpers.ts';
import { createHarness } from './state-harness.ts';
import type { Harness } from './state-harness.ts';

const ID = 'acme.slow';
const COMMAND = `${ID}.run`;

const command = (id = '1', extensionId = ID): ExtRequest => ({
  id,
  method: 'invokeCommand',
  params: { extensionId, commandId: `${extensionId}.run` },
});

const failureOf = (response: ExtResponse) =>
  response.ok ? null : response.error;

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** `server`, который не завершается никогда. */
const hanging: ServerEntry = () => new Promise<void>(() => {});

/** Регистрирует команду `<id>.run`; без `run` она отвечает 'ok'. */
const registerRun = (s: ServerContext, run: CommandHandler = () => 'ok') =>
  s.registerCommand({ id: `${s.extensionId}.run`, title: 'Run', run });

const registrationOf = (result: ReplaceExtensionsResult, id = ID) => {
  const outcome = result.registrations[id];
  if (outcome === undefined) throw new Error(`no registration for ${id}`);
  return outcome;
};

let runtime: ExtensionRuntime | null = null;
let harness: Harness | null = null;
afterEach(async () => {
  vi.useRealTimers();
  await runtime?.dispose();
  await harness?.close();
  runtime = null;
  harness = null;
});

const open = (
  servers: Record<string, ServerEntry | ServerModule>,
  activationTimeoutMs?: number,
): ExtensionRuntime => {
  runtime = createExtensionRuntime({
    library: nullLibrary,
    logger: createLogger(),
    modules: Object.fromEntries(
      Object.entries(servers).map(([id, entry]) => [
        id,
        typeof entry === 'function' ? { server: entry } : entry,
      ]),
    ),
    ...(activationTimeoutMs !== undefined && { activationTimeoutMs }),
  });
  return runtime;
};

const candidates = (...ids: string[]): ExtensionCandidate[] =>
  ids.map((id) => candidateOf(id, { revision: '1' }));

describe('регистрация расширения: server', () => {
  it('регистрации расширения возвращаются в ответе replace', async () => {
    const host = open({
      [ID]: (s) => {
        registerRun(s);
      },
    });
    const outcome = registrationOf(await host.replace(candidates(ID)));
    expect(outcome).toMatchObject({
      ok: true,
      registration: { commands: [{ id: COMMAND, title: 'Run' }] },
    });
    expect(await host.handle(command())).toMatchObject({
      ok: true,
      result: { kind: 'data', value: 'ok' },
    });
  });

  it('server бросает: ok:false с сообщением, вкладов нет, остальные расширения целы', async () => {
    const host = open({
      [ID]: () => {
        throw new Error('boom');
      },
      'acme.fine': (s) => {
        registerRun(s);
      },
    });
    const result = await host.replace(candidates(ID, 'acme.fine'));
    expect(registrationOf(result)).toEqual({ ok: false, error: 'boom' });
    expect(registrationOf(result, 'acme.fine').ok).toBe(true);
    expect(failureOf(await host.handle(command()))).toMatchObject({
      cause: 'unknown-command',
    });
    expect(await host.handle(command('2', 'acme.fine'))).toMatchObject({
      ok: true,
    });
  });

  it('асинхронный отказ server тоже даёт ok:false', async () => {
    const host = open({
      [ID]: async () => {
        await Promise.resolve();
        throw new Error('later boom');
      },
    });
    expect(registrationOf(await host.replace(candidates(ID)))).toEqual({
      ok: false,
      error: 'later boom',
    });
  });

  it('частичная регистрация откатывается: команда, зарегистрированная до исключения, не вызывается', async () => {
    const handler = vi.fn(() => 'ran');
    const host = open({
      [ID]: (s) => {
        registerRun(s, handler);
        throw new Error('after the command');
      },
    });
    const result = await host.replace(candidates(ID));
    expect(registrationOf(result)).toEqual({
      ok: false,
      error: 'after the command',
    });
    expect(failureOf(await host.handle(command()))).toMatchObject({
      cause: 'unknown-command',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('нарушение регистратора (чужой id) в server без перехвата — ошибка расширения', async () => {
    const host = open({
      [ID]: (s) => {
        s.registerCommand({ id: 'other.run', title: 'Run', run: () => 1 });
      },
    });
    const outcome = registrationOf(await host.replace(candidates(ID)));
    expect(outcome).toMatchObject({ ok: false });
    expect(outcome.ok ? '' : outcome.error).toContain("command 'other.run'");
  });

  it('регистрация после возврата server бросает', async () => {
    let captured: ServerContext | null = null;
    const host = open({
      [ID]: (s) => {
        captured = s;
      },
    });
    await host.replace(candidates(ID));
    expect(() => registerRun(captured as unknown as ServerContext)).toThrow(
      /already finished/,
    );
  });

  it('модуль без экспорта server: ok:false «main.mjs does not export server»', async () => {
    const host = open({ [ID]: {} });
    expect(registrationOf(await host.replace(candidates(ID)))).toEqual({
      ok: false,
      error: 'main.mjs does not export server',
    });
  });

  it('кандидат без main и без модуля получает пустую регистрацию', async () => {
    const host = open({});
    const result = await host.replace([
      candidateOf('acme.client-only', { mainPath: null }),
    ]);
    expect(registrationOf(result, 'acme.client-only')).toEqual({
      ok: true,
      registration: EMPTY_SERVER_REGISTRATION,
    });
  });
});

describe('срок регистрации', () => {
  it('вечный server — ok:false ровно через 10 с, а не раньше', async () => {
    vi.useFakeTimers();
    const host = open({ [ID]: hanging });
    expect(ACTIVATION_TIMEOUT_MS).toBe(10_000);
    let settled = false;
    const pending = host.replace(candidates(ID)).then((result) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const outcome = registrationOf(await pending);
    expect(outcome).toMatchObject({ ok: false });
    expect(outcome.ok ? '' : outcome.error).toContain('10000');
    expect(failureOf(await host.handle(command()))).toMatchObject({
      cause: 'unknown-command',
    });
  });

  it('срок настраивается параметром рантайма', async () => {
    vi.useFakeTimers();
    const host = open({ [ID]: hanging }, 250);
    const pending = host.replace(candidates(ID));
    await vi.advanceTimersByTimeAsync(250);
    expect(registrationOf(await pending)).toMatchObject({ ok: false });
  });

  it('просрочившее расширение не задерживает остальных: те уже зарегистрированы', async () => {
    vi.useFakeTimers();
    const host = open({
      [ID]: hanging,
      'acme.fast': (s) => {
        registerRun(s);
      },
    });
    const pending = host.replace(candidates(ID, 'acme.fast'));
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;
    expect(registrationOf(result).ok).toBe(false);
    expect(registrationOf(result, 'acme.fast').ok).toBe(true);
    expect(await host.handle(command('2', 'acme.fast'))).toMatchObject({
      ok: true,
    });
  });

  it('server, уложившийся в срок, не помечается сбоем: часы после него ничего не меняют', async () => {
    vi.useFakeTimers();
    const host = open({
      [ID]: async (s) => {
        await sleep(9_000);
        registerRun(s);
      },
    });
    const pending = host.replace(candidates(ID));
    await vi.advanceTimersByTimeAsync(9_000);
    expect(registrationOf(await pending).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await host.handle(command('2'))).toMatchObject({ ok: true });
  });

  it('расширения загружаются параллельно: два медленных server укладываются в один срок, а не в два', async () => {
    vi.useFakeTimers();
    const slow =
      (answer: string): ServerEntry =>
      async (s) => {
        await sleep(6_000);
        registerRun(s, () => answer);
      };
    const host = open({ 'acme.a': slow('a'), 'acme.b': slow('b') });
    let settled = false;
    const pending = host
      .replace(candidates('acme.a', 'acme.b'))
      .then((result) => {
        settled = true;
        return result;
      });
    await vi.advanceTimersByTimeAsync(5_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(registrationOf(result, 'acme.a').ok).toBe(true);
    expect(registrationOf(result, 'acme.b').ok).toBe(true);
  });

  it('опоздавший server не оживает: регистрации отброшены, его очистка вызывается, когда он вернулся', async () => {
    vi.useFakeTimers();
    const run = vi.fn(() => 'late');
    const cleanup = vi.fn();
    let captured: ServerContext | null = null;
    let thrown: unknown = null;
    const host = open({
      [ID]: async (s) => {
        captured = s;
        await sleep(15_000);
        try {
          registerRun(s, run);
        } catch (error) {
          thrown = error;
        }
        return cleanup;
      },
    });
    const pending = host.replace(candidates(ID));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(registrationOf(await pending).ok).toBe(false);
    expect(cleanup).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(failureOf(await host.handle(command()))).toMatchObject({
      cause: 'unknown-command',
    });
    expect(run).not.toHaveBeenCalled();
    // регистрация после срока бросает в коде автора
    expect(String(thrown)).toMatch(/already finished/);
    // `server` закончил, поздние регистрации из таймеров и колбэков расширения бросают
    expect(() => registerRun(captured as unknown as ServerContext)).toThrow(
      /already finished/,
    );
  });

  it('опоздавший server, который упал, ничего не оставляет и не даёт необработанного отказа', async () => {
    vi.useFakeTimers();
    const host = open({
      [ID]: async () => {
        await sleep(15_000);
        throw new Error('too late');
      },
    });
    const pending = host.replace(candidates(ID));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(registrationOf(await pending).ok).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(failureOf(await host.handle(command()))).toMatchObject({
      cause: 'unknown-command',
    });
  });
});

describe('отказ регистрации (через канал движка)', () => {
  it('расширение, чей server упал, не попадает в обнаружение, его вид — unknown-type, причина — диагностика load-failed', async () => {
    harness = await createHarness({
      candidates: candidates('acme.broken', 'acme.fine'),
      modules: {
        'acme.broken': {
          server: (s) => {
            s.registerExerciseType({
              id: 'acme.broken',
              specSchema: { type: 'object' },
              answerSchema: { type: 'string' },
              project: () => 1,
              grade: () => ({ outcome: 'passed' }),
            });
            throw new Error('boom');
          },
        },
        'acme.fine': { server: (s) => void registerRun(s) },
      },
    });
    const snapshot = harness.discovery.get();
    expect(snapshot.extensions.map(({ id }) => id)).toEqual(['acme.fine']);
    expect(snapshot.diagnostics).toMatchObject([
      {
        extensionId: 'acme.broken',
        diagnostic: { code: 'load-failed', data: { reason: 'boom' } },
      },
    ]);
    expect(
      await harness.channel.call(
        'project',
        { type: 'acme.broken', exerciseId: 'e', spec: {} },
        1000,
      ),
    ).toMatchObject({
      kind: 'response',
      response: { ok: false, error: { cause: 'unknown-type' } },
    });
  });
});
