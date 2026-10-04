import type { ExtensionInfoDto } from '@dolphy-app/engine-contract';
import {
  createFakeExtensionInstaller,
  createFakeExtensionRegistry,
  createFakeExtensionReloader,
  silentLogger,
} from '@dolphy-app/testkit';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { createExtensionApply } from '../../../src/app/extension-apply.ts';
import { createEventBus } from '../../../src/app/event-bus.ts';
import type { EngineEvent } from '@dolphy-app/engine-contract';
import { createTestEngine } from '../../helpers/engine.ts';

const USER: ExtensionInfoDto = {
  id: 'acme.user',
  version: '1.0.0',
  origin: 'user',
  state: 'loaded',
  contributes: {
    exerciseTypes: [],
    themes: [],
    markdownRenderers: [],
    gradePolicies: [],
    settings: [],
    events: [],
    commands: [],
    panels: [],
  },
  diagnostics: [],
  permissions: [],
  isolation: 'isolated',
  toggleable: true,
  name: null,
  description: null,
  author: null,
  installed: null,
  icon: null,
  titles: {},
  messages: {},
  tags: [],
  removable: true,
  revoked: null,
};

/** Перезагрузка, которую тест завершает вручную: видно, что идёт и что ждёт. */
const gatedReloader = () => {
  const gates: (() => void)[] = [];
  const log: string[] = [];
  let started = 0;
  const reloader = createFakeExtensionReloader(() => {
    const run = ++started;
    log.push(`start ${run}`);
    return new Promise<void>((resolve) => {
      gates.push(() => {
        log.push(`end ${run}`);
        resolve();
      });
    });
  });
  return { reloader, log, release: () => gates.shift()?.() };
};

const setup = (reloader: ReturnType<typeof createFakeExtensionReloader>) => {
  const bus = createEventBus(silentLogger);
  const published: EngineEvent[] = [];
  bus.subscribe((event) => published.push(event));
  const state = { closed: false };
  const apply = createExtensionApply({
    reloader,
    bus,
    logger: silentLogger,
    state,
  });
  return { apply, published, state };
};

/** Пропускает все ожидающие микрозадачи и один такт цикла событий (без часов). */
const tick = (): Promise<void> => nextTurn();

describe('createExtensionApply', () => {
  it('publishes contributions-changed only after the reload finished', async () => {
    const { reloader, release } = gatedReloader();
    const { apply, published } = setup(reloader);
    const done = apply.reload();
    await tick();
    expect(published).toEqual([]);
    release();
    await done;
    expect(published).toEqual([
      { type: 'contributions-changed', generation: 1 },
    ]);
    expect(apply.generation()).toBe(1);
  });

  it('runs reloads one at a time and folds requests made while one runs into a single next run', async () => {
    const { reloader, log, release } = gatedReloader();
    const { apply, published } = setup(reloader);
    const first = apply.reload();
    await tick();
    const second = apply.reload();
    const third = apply.reload();
    await tick();
    expect(log).toEqual(['start 1']);
    release();
    await first;
    await tick();
    // второй и третий вызовы — одна следующая перезагрузка, начатая после обоих
    expect(log).toEqual(['start 1', 'end 1', 'start 2']);
    release();
    await Promise.all([second, third]);
    expect(log).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
    expect(published.map((event) => event.type)).toEqual([
      'contributions-changed',
      'contributions-changed',
    ]);
    expect(apply.generation()).toBe(2);
  });

  it('a failed reload is logged, keeps the generation and does not block the next one', async () => {
    let attempt = 0;
    const reloader = createFakeExtensionReloader(() => {
      attempt += 1;
      if (attempt === 1) throw new Error('roots unreadable');
    });
    const { apply, published } = setup(reloader);
    await expect(apply.reload()).resolves.toBeUndefined();
    expect(published).toEqual([]);
    expect(apply.generation()).toBe(0);
    await apply.reload();
    expect(published).toEqual([
      { type: 'contributions-changed', generation: 1 },
    ]);
  });

  it('does nothing once the engine is closed', async () => {
    const reloader = createFakeExtensionReloader();
    const { apply, published, state } = setup(reloader);
    state.closed = true;
    await apply.reload();
    expect(reloader.calls()).toBe(0);
    expect(published).toEqual([]);
  });
});

describe('extensions install/uninstall apply the new set', () => {
  const open = () => {
    const order: string[] = [];
    const reloader = createFakeExtensionReloader(() => {
      order.push('reload');
    });
    return createTestEngine({
      extensionRegistry: createFakeExtensionRegistry([USER]),
      extensionInstaller: createFakeExtensionInstaller({
        handlers: {
          install: async (id) => {
            order.push('install');
            return { id, version: '1.0.0', previousVersion: null };
          },
          uninstall: async () => {
            order.push('uninstall');
          },
        },
      }),
      extensionReloader: reloader,
    }).then((t) => {
      t.engine.subscribe((event) => order.push(event.type));
      return { ...t, order };
    });
  };

  it('install: files first, then the reload, then the announcements', async () => {
    const { engine, order } = await open();
    await engine.extensions.install('acme.new');
    expect(order).toEqual([
      'install',
      'reload',
      'contributions-changed',
      'extensions-changed',
    ]);
  });

  it('uninstall: files first, then the reload, then the announcements', async () => {
    const { engine, order } = await open();
    await engine.extensions.uninstall('acme.user');
    expect(order).toEqual([
      'uninstall',
      'reload',
      'contributions-changed',
      'extensions-changed',
    ]);
  });

  it('a failed install does not reload', async () => {
    const reloader = createFakeExtensionReloader();
    const { engine } = await createTestEngine({
      extensionInstaller: createFakeExtensionInstaller({
        handlers: {
          install: async () => {
            throw new Error('offline');
          },
        },
      }),
      extensionReloader: reloader,
    });
    await expect(engine.extensions.install('acme.new')).rejects.toBeDefined();
    expect(reloader.calls()).toBe(0);
  });
});
