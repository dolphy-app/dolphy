import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedExtension } from '../src/discover.ts';
import { EngineRequestError } from '../src/engine-link.ts';
import type { EngineLink } from '../src/engine-link.ts';
import type { ExtRequest, ExtResponse } from '../src/protocol.ts';
import type {
  ChildMessage,
  ParentMessage,
} from '../src/restricted-protocol.ts';
import { createRestrictedRunner } from '../src/restricted-runner.ts';
import type { RestrictedChild, SpawnSpec } from '../src/restricted-runner.ts';
import { createLogger, nullEngine } from './helpers.ts';

interface FakeChild extends RestrictedChild {
  sent: ParentMessage[];
  killed: boolean;
  emit(message: ChildMessage): void;
  output(stream: 'stdout' | 'stderr', text: string): void;
  exit(code: number | null, signal?: string | null): void;
}

interface Behavior {
  autoReady?: boolean;
  reply?(request: ExtRequest): ExtResponse | undefined;
  exitOnShutdown?: boolean;
}

const createFakeChild = ({
  autoReady = true,
  reply,
  exitOnShutdown = true,
}: Behavior = {}): FakeChild => {
  const messages: ((message: unknown) => void)[] = [];
  const exits: ((code: number | null, signal: string | null) => void)[] = [];
  const outputs: ((stream: 'stdout' | 'stderr', text: string) => void)[] = [];
  const child: FakeChild = {
    sent: [],
    killed: false,
    send(message) {
      child.sent.push(message);
      if (message.t === 'init' && autoReady) {
        queueMicrotask(() => child.emit({ t: 'ready' }));
      }
      if (message.t === 'rpc') {
        const { message: sent } = message;
        const response =
          'method' in sent && 'id' in sent ? reply?.(sent) : undefined;
        if (response !== undefined) {
          queueMicrotask(() => child.emit({ t: 'rpc', message: response }));
        }
      }
      if (message.t === 'shutdown' && exitOnShutdown) {
        queueMicrotask(() => child.exit(0));
      }
    },
    onMessage: (listener) => void messages.push(listener),
    onExit: (listener) => void exits.push(listener),
    onOutput: (listener) => void outputs.push(listener),
    kill() {
      child.killed = true;
      child.exit(null, 'SIGKILL');
    },
    emit: (message) => messages.forEach((listener) => listener(message)),
    output: (stream, text) => outputs.forEach((l) => l(stream, text)),
    exit: (code, signal = null) => exits.forEach((l) => l(code, signal)),
  };
  return child;
};

const ok = (request: ExtRequest): ExtResponse => ({
  id: request.id,
  ok: true,
  result: { echoed: request.id },
});

let root = '';
let extensionDir = '';
let entryPath = '';

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'dolphy-runner-')));
  extensionDir = path.join(root, 'ext');
  await mkdir(extensionDir);
  entryPath = path.join(root, 'restricted', 'child.mjs');
  await mkdir(path.dirname(entryPath));
  await writeFile(entryPath, '');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

const extensionOf = (
  permissions: ResolvedExtension['permissions'] = [],
): ResolvedExtension => ({
  id: 'acme.fake',
  version: '1.0.0',
  origin: 'user',
  revision: '',
  dir: extensionDir,
  mainPath: path.join(extensionDir, 'main.mjs'),
  permissions,
  name: null,
  description: null,
  author: null,
  platforms: [],
  minAppVersion: null,
  icon: null,
  tags: [],
  install: null,
  exerciseTypes: [],
  themes: [],
  markdownRenderers: [],
  gradePolicies: [],
  settings: [],
  events: [],
  commands: [],
  panels: [],
});

const gradeRequest = (id: string, timeoutMs = 2000): ExtRequest => ({
  id,
  method: 'grade',
  params: {
    type: 'acme.fake',
    exerciseId: 'e',
    spec: {},
    answer: 'a',
    timeoutMs,
    authorMode: false,
    isolated: true,
  },
});

const projectRequest = (id: string): ExtRequest => ({
  id,
  method: 'project',
  params: { type: 'acme.fake', exerciseId: 'e', spec: {}, isolated: true },
});

const commandRequest = (id: string): ExtRequest => ({
  id,
  method: 'invokeCommand',
  params: {
    extensionId: 'acme.fake',
    commandId: 'acme.fake.go',
    isolated: true,
  },
});

const setup = (
  behaviors: Behavior[] | (() => Behavior),
  options: {
    permissions?: ResolvedExtension['permissions'];
    library?: {
      readText: (path: string) => Promise<string>;
      stat: () => Promise<null>;
    };
    graceMs?: number;
    engine?: EngineLink;
  } = {},
) => {
  const children: FakeChild[] = [];
  const specs: SpawnSpec[] = [];
  const logger = createLogger();
  const runner = createRestrictedRunner({
    extension: extensionOf(options.permissions),
    entryPath,
    library: options.library ?? {
      readText: async () => '',
      stat: async () => null,
    },
    engine: options.engine ?? nullEngine,
    logger,
    ...(options.graceMs !== undefined && { graceMs: options.graceMs }),
    spawn: (spec) => {
      specs.push(spec);
      const behavior =
        typeof behaviors === 'function'
          ? behaviors()
          : (behaviors[children.length] ?? {});
      const child = createFakeChild(behavior);
      children.push(child);
      return child;
    },
  });
  return { runner, children, specs, logger };
};

describe('ограниченный раннер', () => {
  it('процесс поднимается лениво, один на все запросы, с минимальным окружением и реальными путями', async () => {
    const { runner, children, specs } = setup(() => ({ reply: ok }), {
      permissions: ['process.spawn'],
    });
    expect(specs).toHaveLength(0);
    const responses = await Promise.all([
      runner.handle(projectRequest('1')),
      runner.handle(gradeRequest('2')),
    ]);
    expect(responses).toEqual([
      { id: '1', ok: true, result: { echoed: '1' } },
      { id: '2', ok: true, result: { echoed: '2' } },
    ]);
    expect(specs).toHaveLength(1);
    expect(specs[0]?.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
    expect(specs[0]?.args).toEqual([
      expect.stringMatching(/^--(experimental-)?permission$/),
      `--allow-fs-read=${extensionDir}`,
      `--allow-fs-read=${path.dirname(entryPath)}`,
      '--allow-child-process',
      entryPath,
    ]);
    expect(children[0]?.sent[0]).toMatchObject({
      t: 'init',
      extension: { id: 'acme.fake', permissions: ['process.spawn'] },
    });
    await runner.dispose();
  });

  it('падение процесса с запросами в полёте: они получают handler-failed, следующий запрос поднимает новый процесс', async () => {
    const { runner, children } = setup([{}, { reply: ok }]);
    const inFlight = runner.handle(gradeRequest('1'));
    await vi.waitFor(() =>
      expect(children[0]?.sent.some(({ t }) => t === 'rpc')).toBe(true),
    );
    children[0]?.exit(7);
    expect(await inFlight).toEqual({
      id: '1',
      ok: false,
      error: {
        cause: 'handler-failed',
        message: 'extension process exited (code 7)',
      },
    });
    expect(await runner.handle(projectRequest('2'))).toMatchObject({
      ok: true,
    });
    expect(children).toHaveLength(2);
    await runner.dispose();
  });

  it('зависший вызов: по дедлайну timeoutMs + graceMs процесс убивается', async () => {
    const { runner, children } = setup([{}], { graceMs: 30 });
    const started = Date.now();
    const response = await runner.handle(gradeRequest('1', 30));
    expect(response).toEqual({
      id: '1',
      ok: false,
      error: {
        cause: 'handler-failed',
        message: 'extension process was killed: deadline exceeded',
      },
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
    expect(children[0]?.killed).toBe(true);
  });

  it('процесс, который не сообщил ready, не вешает вызов бесконечно', async () => {
    const children: FakeChild[] = [];
    const runner = createRestrictedRunner({
      extension: extensionOf(),
      entryPath,
      library: { readText: async () => '', stat: async () => null },
      engine: nullEngine,
      logger: createLogger(),
      readyTimeoutMs: 30,
      spawn: () => {
        const child = createFakeChild({ autoReady: false });
        children.push(child);
        return child;
      },
    });
    const response = await runner.handle(projectRequest('1'));
    expect(response).toMatchObject({
      ok: false,
      error: { cause: 'activation-timeout' },
    });
    expect(children[0]?.killed).toBe(true);
    // сбой по сроку запоминается: процесс заново не поднимается
    const again = await runner.handle(projectRequest('2'));
    expect(again).toMatchObject({
      ok: false,
      error: { cause: 'activation-timeout' },
    });
    expect(children).toHaveLength(1);
  });

  it('срок вызова вышел раньше срока готовности: вызвавший получает activation-timeout, а не чужой дедлайн', async () => {
    const children: FakeChild[] = [];
    const runner = createRestrictedRunner({
      extension: extensionOf(),
      entryPath,
      library: { readText: async () => '', stat: async () => null },
      engine: nullEngine,
      logger: createLogger(),
      readyTimeoutMs: 500,
      commandDeadlineMs: 30,
      spawn: () => {
        const child = createFakeChild({ autoReady: false });
        children.push(child);
        return child;
      },
    });
    const response = await runner.handle(commandRequest('1'));
    expect(response).toMatchObject({
      ok: false,
      error: { cause: 'activation-timeout' },
    });
    expect(children[0]?.killed).toBe(true);
  });

  it('вызов, не уложившийся в срок после готовности, остаётся сбоем вызова', async () => {
    const children: FakeChild[] = [];
    const runner = createRestrictedRunner({
      extension: extensionOf(),
      entryPath,
      library: { readText: async () => '', stat: async () => null },
      engine: nullEngine,
      logger: createLogger(),
      commandDeadlineMs: 30,
      spawn: () => {
        const child = createFakeChild({ reply: () => undefined });
        children.push(child);
        return child;
      },
    });
    const response = await runner.handle(commandRequest('1'));
    expect(response).toMatchObject({
      ok: false,
      error: { cause: 'handler-timeout' },
    });
  });

  it('цикл падений: после более чем 5 выходов за минуту минуту не запускаем процесс', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const { runner, children } = setup(() => ({}));
    const crash = async (index: number) => {
      const pending = runner.handle(projectRequest(String(index)));
      await vi.waitFor(() => expect(children).toHaveLength(index + 1));
      await vi.waitFor(() =>
        expect(children[index]?.sent.some(({ t }) => t === 'rpc')).toBe(true),
      );
      children[index]?.exit(1);
      await pending;
    };
    for (let index = 0; index < 6; index += 1) {
      await crash(index);
      now += 1000;
    }
    expect(children).toHaveLength(6);
    expect(await runner.handle(projectRequest('x'))).toEqual({
      id: 'x',
      ok: false,
      error: {
        cause: 'activation-failed',
        message: 'extension process keeps crashing',
      },
    });
    expect(children).toHaveLength(6);
    now += 61_000;
    const after = runner.handle(projectRequest('y'));
    await vi.waitFor(() => expect(children).toHaveLength(7));
    children[6]?.exit(1);
    await after;
  });

  it('dispose: просит процесс завершиться и отказывает в новых запросах', async () => {
    const { runner, children } = setup([{ reply: ok }]);
    await runner.handle(projectRequest('1'));
    await runner.dispose();
    expect(children[0]?.sent.at(-1)).toEqual({ t: 'shutdown' });
    expect(children[0]?.killed).toBe(false);
    expect(await runner.handle(projectRequest('2'))).toMatchObject({
      ok: false,
      error: { cause: 'activation-failed' },
    });
    expect(children).toHaveLength(1);
  });

  it('dispose: процесс, не ответивший на shutdown, убивается через секунду', async () => {
    const { runner, children } = setup([{ reply: ok, exitOnShutdown: false }]);
    await runner.handle(projectRequest('1'));
    await runner.dispose();
    expect(children[0]?.killed).toBe(true);
  });

  it('вывод процесса и его логи попадают в журнал с id расширения', async () => {
    const { runner, children, logger } = setup([{ reply: ok }]);
    await runner.handle(projectRequest('1'));
    children[0]?.output('stderr', 'boom\n\nsecond\n');
    children[0]?.emit({
      t: 'log',
      level: 'info',
      fields: { a: 1 },
      message: 'hello',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      { extensionId: 'acme.fake', stream: 'stderr' },
      'boom',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      { extensionId: 'acme.fake', stream: 'stderr' },
      'second',
    );
    expect(logger.info).toHaveBeenCalledWith(
      { a: 1, extensionId: 'acme.fake' },
      'hello',
    );
    await runner.dispose();
  });

  describe('библиотека через родителя', () => {
    const readLibrary = async (
      child: FakeChild,
      id: string,
    ): Promise<ParentMessage | undefined> => {
      child.emit({ t: 'library', id, op: 'readText', path: 'lib/a.md' });
      await vi.waitFor(() =>
        expect(
          child.sent.some((m) => m.t === 'library-result' && m.id === id),
        ).toBe(true),
      );
      return child.sent.find((m) => m.t === 'library-result' && m.id === id);
    };

    it('без library.read родитель отказывает сам, даже если процесс «врёт»', async () => {
      const readText = vi.fn(async () => 'secret');
      const { runner, children } = setup([{ reply: ok }], {
        library: { readText, stat: async () => null },
      });
      await runner.handle(projectRequest('1'));
      expect(await readLibrary(children[0] as FakeChild, 'l1')).toMatchObject({
        ok: false,
        error: { name: 'PermissionError', permission: 'library.read' },
      });
      expect(readText).not.toHaveBeenCalled();
      await runner.dispose();
    });

    it('с library.read запрос выполняется настоящим читателем', async () => {
      const readText = vi.fn(async (file: string) => `text of ${file}`);
      const { runner, children } = setup([{ reply: ok }], {
        permissions: ['library.read'],
        library: { readText, stat: async () => null },
      });
      await runner.handle(projectRequest('1'));
      expect(await readLibrary(children[0] as FakeChild, 'l1')).toEqual({
        t: 'library-result',
        id: 'l1',
        ok: true,
        value: 'text of lib/a.md',
      });
      await runner.dispose();
    });

    it('ошибка читателя возвращается процессу, а не роняет хост', async () => {
      const { runner, children } = setup([{ reply: ok }], {
        permissions: ['library.read'],
        library: {
          readText: async () => {
            throw new Error('nope');
          },
          stat: async () => null,
        },
      });
      await runner.handle(projectRequest('1'));
      expect(await readLibrary(children[0] as FakeChild, 'l1')).toMatchObject({
        ok: false,
        error: { message: 'nope' },
      });
      await runner.dispose();
    });
  });
});

describe('запросы ограниченного процесса к данным расширения', () => {
  /** Поднимает процесс одним вызовом и возвращает его, чтобы тест писал от его имени. */
  const started = async (options: { engine: EngineLink }) => {
    const made = setup([{ reply: ok }], options);
    await made.runner.handle(projectRequest('1'));
    const child = made.children[0] as FakeChild;
    const replies = () =>
      child.sent
        .filter(({ t }) => t === 'rpc')
        .map((message) => (message as { message: unknown }).message);
    return { ...made, child, replies };
  };

  it('запрос идёт к движку с id этого расширения; чужой id из процесса подменяется', async () => {
    const request = vi.fn(async () => ['kept']);
    const { child, replies } = await started({
      engine: { request } as EngineLink,
    });

    child.emit({
      t: 'rpc',
      message: {
        id: 'h0',
        method: 'storage.keys',
        params: { extensionId: 'acme.victim' },
      },
    });

    await vi.waitFor(() =>
      expect(replies()).toContainEqual({
        id: 'h0',
        ok: true,
        result: ['kept'],
      }),
    );
    expect(request).toHaveBeenCalledWith('storage.keys', {
      extensionId: 'acme.fake',
    });
  });

  it('отказ движка уходит процессу с кодом и details; неверная форма не доходит до движка', async () => {
    const request = vi.fn(async () => {
      throw new EngineRequestError({
        code: 'EXTENSION_STORAGE_QUOTA',
        message: 'too big',
        details: { kind: 'value-size', limit: 65536 },
      });
    });
    const { child, replies } = await started({
      engine: { request } as EngineLink,
    });

    child.emit({
      t: 'rpc',
      message: {
        id: 'h1',
        method: 'storage.set',
        params: { extensionId: 'x', key: 'k', value: 1 },
      },
    });
    child.emit({
      t: 'rpc',
      message: { id: 'h2', method: 'storage.wipe', params: {} } as never,
    });

    await vi.waitFor(() => expect(replies()).toHaveLength(3));
    expect(replies()).toContainEqual({
      id: 'h1',
      ok: false,
      error: {
        code: 'EXTENSION_STORAGE_QUOTA',
        message: 'too big',
        details: { kind: 'value-size', limit: 65536 },
      },
    });
    expect(replies()).toContainEqual({
      id: 'h2',
      ok: false,
      error: { code: 'INVALID_ARGUMENT', message: expect.any(String) },
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('изменение настройки передаётся запущенному процессу и теряется, пока процесса нет', async () => {
    const notice = {
      method: 'settingChanged' as const,
      params: { extensionId: 'acme.fake', id: 'acme.fake.x', value: 2 },
    };
    const idle = setup([{ reply: ok }]);
    idle.runner.notify(notice);
    expect(idle.children).toHaveLength(0);

    const { runner, replies } = await started({ engine: nullEngine });
    runner.notify(notice);

    expect(replies()).toContainEqual(notice);
  });
});
