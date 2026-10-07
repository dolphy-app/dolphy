import { fileURLToPath } from 'node:url';
import type { ExtensionModule } from '@dolphy-app/extension-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverExtensions } from '../src/discover.ts';
import type { ResolvedExtension } from '../src/discover.ts';
import type { ExtRequest, ExtResponse } from '../src/protocol.ts';
import {
  ACTIVATION_TIMEOUT_MS,
  createExtensionRuntime,
} from '../src/runtime.ts';
import type { ExtensionRuntime } from '../src/runtime.ts';
import { createLogger, nullLibrary } from './helpers.ts';
import { stateful } from './state-harness.ts';

const fixtures = fileURLToPath(
  new URL('./fixtures/extensions', import.meta.url),
);

const ID = 'acme.slow';
const COMMAND = `${ID}.run`;

const commandsExtension = (): ResolvedExtension =>
  stateful(ID, {
    commands: [
      {
        id: COMMAND,
        title: 'Run',
        description: null,
        category: null,
        keybinding: null,
        keybindings: [],
        when: null,
        icon: 'puzzle',
        palette: true,
      },
    ],
  });

const command = (id = '1'): ExtRequest => ({
  id,
  method: 'invokeCommand',
  params: { extensionId: ID, commandId: COMMAND },
});

const event = (id = '1'): ExtRequest => ({
  id,
  method: 'deliverEvent',
  params: {
    extensionId: ID,
    name: 'session.started',
    payload: { sessionId: 's', at: 1 },
  },
});

const project = (id = '1'): ExtRequest => ({
  id,
  method: 'project',
  params: { type: 'acme.echo', exerciseId: 'e', spec: {} },
});

const grade = (id = '1'): ExtRequest => ({
  id,
  method: 'grade',
  params: {
    type: 'acme.echo',
    exerciseId: 'e',
    spec: {},
    answer: 1,
    timeoutMs: 1000,
    authorMode: false,
  },
});

const echoExtensions = async (): Promise<ResolvedExtension[]> =>
  (
    await discoverExtensions({
      roots: [{ dir: fixtures, origin: 'bundled' }],
      logger: createLogger(),
    })
  ).extensions;

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** `activate()`, который не завершается никогда. */
const hanging = (): ExtensionModule => ({
  activate: () => new Promise<void>(() => {}),
});

let runtime: ExtensionRuntime | null = null;
afterEach(async () => {
  vi.useRealTimers();
  await runtime?.dispose();
  runtime = null;
});

const open = (
  extensions: readonly ResolvedExtension[],
  modules: Record<string, ExtensionModule>,
  activationTimeoutMs?: number,
): ExtensionRuntime => {
  runtime = createExtensionRuntime({
    extensions,
    library: nullLibrary,
    logger: createLogger(),
    modules,
    ...(activationTimeoutMs !== undefined && { activationTimeoutMs }),
  });
  return runtime;
};

/** Вызов с фальшивыми часами: ответ приходит, когда пройдёт `ms`. */
const answerAfter = async (
  pending: Promise<ExtResponse>,
  ms: number,
): Promise<ExtResponse> => {
  await vi.advanceTimersByTimeAsync(ms);
  return pending;
};

const failureOf = (response: ExtResponse) =>
  response.ok ? null : response.error;

describe('срок активации в процессе хоста', () => {
  it('вечный activate() — activation-timeout ровно через 10 с, а не раньше', async () => {
    vi.useFakeTimers();
    const host = open([commandsExtension()], { [ID]: hanging() });
    expect(ACTIVATION_TIMEOUT_MS).toBe(10_000);

    let settled = false;
    const pending = host.handle(command()).then((response) => {
      settled = true;
      return response;
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe(false);
    const response = await answerAfter(pending, 1);
    expect(failureOf(response)).toMatchObject({ cause: 'activation-timeout' });
  });

  it('тот же срок для события, project и grade: вызвавший получает activation-timeout', async () => {
    vi.useFakeTimers();
    const echo = await echoExtensions();
    const host = open([commandsExtension(), ...echo], {
      [ID]: hanging(),
      'acme.echo': hanging(),
    });
    for (const request of [event(), project('2'), grade('3')]) {
      const response = await answerAfter(
        host.handle(request),
        ACTIVATION_TIMEOUT_MS,
      );
      expect(failureOf(response)).toMatchObject({
        cause: 'activation-timeout',
      });
    }
  });

  it('срок настраивается параметром рантайма', async () => {
    vi.useFakeTimers();
    const host = open([commandsExtension()], { [ID]: hanging() }, 250);
    const response = await answerAfter(host.handle(command()), 250);
    expect(failureOf(response)).toMatchObject({ cause: 'activation-timeout' });
  });

  it('сбой запоминается: activate() вызван один раз, повторные вызовы получают причину сразу', async () => {
    vi.useFakeTimers();
    const activate = vi.fn(() => new Promise<void>(() => {}));
    const host = open([commandsExtension()], { [ID]: { activate } });

    const first = await answerAfter(host.handle(command('1')), 10_000);
    expect(failureOf(first)).toMatchObject({ cause: 'activation-timeout' });
    // без продвижения часов: ответ уже готов
    for (const id of ['2', '3']) {
      expect(failureOf(await host.handle(command(id)))).toMatchObject({
        cause: 'activation-timeout',
      });
    }
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('после замены сборки activate() вызывается заново — один раз', async () => {
    vi.useFakeTimers();
    const activate = vi.fn(() => new Promise<void>(() => {}));
    const host = open([commandsExtension()], { [ID]: { activate } });
    await answerAfter(host.handle(command('1')), 10_000);
    expect(activate).toHaveBeenCalledTimes(1);

    await host.replace([{ ...commandsExtension(), version: '1.0.1' }]);
    const again = await answerAfter(host.handle(command('2')), 10_000);
    expect(failureOf(again)).toMatchObject({ cause: 'activation-timeout' });
    await host.handle(command('3'));
    expect(activate).toHaveBeenCalledTimes(2);
  });

  it('активация, уложившаяся в срок, не помечается сбоем: часы после неё ничего не меняют', async () => {
    vi.useFakeTimers();
    const host = open([commandsExtension()], {
      [ID]: {
        activate: async (ctx) => {
          await sleep(9_000);
          ctx.commands.register(COMMAND, () => 'ok');
        },
      },
    });
    const response = await answerAfter(host.handle(command()), 9_000);
    expect(response).toMatchObject({ ok: true });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await host.handle(command('2'))).toMatchObject({ ok: true });
  });

  it('команда, зарегистрированная после срока, не оживает: ответ — activation-timeout', async () => {
    vi.useFakeTimers();
    const late = vi.fn();
    const host = open([commandsExtension()], {
      [ID]: {
        activate: async (ctx) => {
          await sleep(15_000);
          ctx.commands.register(COMMAND, late);
        },
      },
    });
    const first = await answerAfter(host.handle(command('1')), 10_000);
    expect(failureOf(first)).toMatchObject({ cause: 'activation-timeout' });

    // `activate()` всё-таки завершился и зарегистрировал команду
    await vi.advanceTimersByTimeAsync(10_000);
    const second = await host.handle(command('2'));
    expect(failureOf(second)).toMatchObject({ cause: 'activation-timeout' });
    expect(late).not.toHaveBeenCalled();
  });

  it('поздняя регистрация события и вида задания ничего не регистрирует и не бросает', async () => {
    vi.useFakeTimers();
    const errors: unknown[] = [];
    const echo = await echoExtensions();
    const host = open([...echo], {
      'acme.echo': {
        activate: async (ctx) => {
          await sleep(15_000);
          try {
            ctx.registerExerciseType('acme.echo', {
              project: () => 1,
              grade: () => ({ outcome: 'passed' }),
            });
          } catch (error) {
            errors.push(error);
          }
        },
      },
    });
    const first = await answerAfter(host.handle(project('1')), 10_000);
    expect(failureOf(first)).toMatchObject({ cause: 'activation-timeout' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(errors).toEqual([]);
    const second = await host.handle(project('2'));
    expect(failureOf(second)).toMatchObject({ cause: 'activation-timeout' });
  });
});
