import { describe, expect, it, vi } from 'vitest';
import {
  EXTENSION_COMMAND_LIMITS,
  defineExtension,
  notify,
  openPanel,
  type CommandHandler,
  type ExtensionLogger,
} from '../src/index.ts';
import {
  createMemoryLibrary,
  createMemorySettings,
  createMemoryStorage,
  loadCommands,
} from '../src/testing.ts';

const moduleOf = (commands: Record<string, CommandHandler>) =>
  defineExtension({ commands });

describe('notify / openPanel', () => {
  it('возвращают ровно эффект, у openPanel без props ключа props нет', () => {
    expect(notify('готово')).toEqual({ notify: 'готово' });
    expect(openPanel('p')).toStrictEqual({ openPanel: 'p' });
    expect(openPanel('p', { a: 1 })).toStrictEqual({
      openPanel: 'p',
      props: { a: 1 },
    });
    expect(openPanel('p', 0)).toStrictEqual({ openPanel: 'p', props: 0 });
  });

  it('проходят через run как эффекты', async () => {
    const loaded = await loadCommands(
      moduleOf({
        'a.notify': () => notify('hi'),
        'a.open': () => openPanel('p'),
        'a.props': () => openPanel('p', [1, 2]),
      }),
    );
    expect(await loaded.run('a.notify')).toEqual({
      kind: 'notify',
      text: 'hi',
    });
    expect(await loaded.run('a.open')).toStrictEqual({
      kind: 'openPanel',
      panelId: 'p',
    });
    expect(await loaded.run('a.props')).toEqual({
      kind: 'openPanel',
      panelId: 'p',
      props: [1, 2],
    });
  });
});

describe('loadCommands', () => {
  it('приводит каждый вид результата', async () => {
    const loaded = await loadCommands(
      moduleOf({
        'a.none': () => undefined,
        'a.null': () => null,
        'a.data': () => ({ rows: [1, 2], skipped: undefined }) as never,
        'a.async': async () => 'text',
      }),
    );
    expect(await loaded.run('a.none')).toEqual({ kind: 'none' });
    expect(await loaded.run('a.null')).toEqual({ kind: 'none' });
    expect(await loaded.run('a.data')).toEqual({
      kind: 'data',
      value: { rows: [1, 2] },
    });
    expect(await loaded.run('a.async')).toEqual({
      kind: 'data',
      value: 'text',
    });
  });

  it('ids() — в порядке регистрации', async () => {
    const loaded = await loadCommands(
      moduleOf({ 'a.z': () => 1, 'a.b': () => 2, 'a.m': () => 3 }),
    );
    expect(loaded.ids()).toEqual(['a.z', 'a.b', 'a.m']);
  });

  it('незарегистрированная команда отклоняет run', async () => {
    const loaded = await loadCommands(moduleOf({ 'a.x': () => 1 }));
    await expect(loaded.run('a.missing')).rejects.toThrow(
      "command 'a.missing' was not registered",
    );
  });

  it('declaredCommands: необъявленная регистрация падает при загрузке и называет команду', async () => {
    await expect(
      loadCommands(moduleOf({ 'a.ok': () => 1, 'a.rogue': () => 2 }), {
        declaredCommands: ['a.ok'],
      }),
    ).rejects.toThrow(/a\.rogue/);
  });

  it('повторная регистрация той же команды бросает', async () => {
    const module = defineExtension({
      commands: { 'a.x': () => 1 },
      activate: (context) => {
        context.commands.register('a.x', () => 2);
      },
    });
    await expect(loadCommands(module)).rejects.toThrow(/a\.x.*already/);
  });

  it('declaredPanels ограничивает openPanel; без него годится любая панель', async () => {
    const module = moduleOf({
      'a.known': () => openPanel('known'),
      'a.other': () => openPanel('other'),
    });
    const restricted = await loadCommands(module, {
      declaredPanels: ['known'],
    });
    expect(await restricted.run('a.known')).toEqual({
      kind: 'openPanel',
      panelId: 'known',
    });
    await expect(restricted.run('a.other')).rejects.toThrow(
      /invalid command result.*other/,
    );
    const open = await loadCommands(module);
    expect(await open.run('a.other')).toEqual({
      kind: 'openPanel',
      panelId: 'other',
    });
  });

  it('недопустимые результаты отклоняются как invalid command result', async () => {
    const loaded = await loadCommands(
      moduleOf({
        'a.big': () => 'x'.repeat(EXTENSION_COMMAND_LIMITS.resultBytes),
        'a.mixed': () => ({ notify: 'x', extra: 1 }) as never,
        'a.fn': () => (() => 1) as never,
        'a.bigint': () => 5n as never,
      }),
    );
    for (const id of ['a.big', 'a.mixed', 'a.fn', 'a.bigint']) {
      await expect(loaded.run(id)).rejects.toThrow(/^invalid command result: /);
    }
  });

  it('границы args: ровно 200000 символов JSON проходит, больше — нет', async () => {
    const received: unknown[] = [];
    const loaded = await loadCommands(
      moduleOf({
        'a.echo': (args) => {
          received.push(args);
        },
      }),
    );
    const limit = EXTENSION_COMMAND_LIMITS.argsChars;
    const exact = 'a'.repeat(limit - 2); // + две кавычки JSON
    await loaded.run('a.echo', exact);
    expect(received).toEqual([exact]);
    await expect(loaded.run('a.echo', `${exact}a`)).rejects.toThrow(/args/);
    expect(received).toHaveLength(1);
  });

  it('обработчик получает undefined без args и JSON с args', async () => {
    const received: unknown[] = [];
    const loaded = await loadCommands(
      moduleOf({ 'a.echo': (args) => void received.push(args) }),
    );
    await loaded.run('a.echo');
    await loaded.run('a.echo', { n: [1] });
    await loaded.run('a.echo', null);
    expect(received).toEqual([undefined, { n: [1] }, null]);
  });

  it('сбой обработчика доходит до вызывающего как есть', async () => {
    const boom = new Error('boom');
    const loaded = await loadCommands(
      moduleOf({
        'a.fail': () => {
          throw boom;
        },
      }),
    );
    await expect(loaded.run('a.fail')).rejects.toBe(boom);
  });

  it('storage, settings, events, library и logger из опций видны в activate', async () => {
    const storage = createMemoryStorage();
    const settings = createMemorySettings([
      { id: 'a.mode', type: 'string', label: 'Mode', default: 'fast' },
    ]);
    const library = createMemoryLibrary({ 'notes.txt': 'hello' });
    const logger: ExtensionLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const module = defineExtension({
      activate: (context) => {
        context.commands.register('a.work', async () => {
          context.logger.info({ ok: true }, 'ran');
          await context.storage.set(
            'last',
            await context.library.readText('notes.txt'),
          );
          return { mode: context.settings.get('a.mode') };
        });
      },
    });
    const loaded = await loadCommands(module, {
      storage,
      settings,
      library,
      logger,
    });
    await settings.set('a.mode', 'slow');
    expect(await loaded.run('a.work')).toEqual({
      kind: 'data',
      value: { mode: 'slow' },
    });
    expect(await storage.get('last')).toBe('hello');
    expect(logger.info).toHaveBeenCalledWith({ ok: true }, 'ran');
  });

  it('dispose вызывает deactivate модуля; после него команды можно зарегистрировать заново', async () => {
    const deactivate = vi.fn();
    const module = defineExtension({
      commands: { 'a.x': () => 1 },
      deactivate,
    });
    const first = await loadCommands(module);
    await first.dispose();
    expect(deactivate).toHaveBeenCalledTimes(1);
    const second = await loadCommands(module);
    expect(second.ids()).toEqual(['a.x']);
    expect(await second.run('a.x')).toEqual({ kind: 'data', value: 1 });
  });

  it('dispose снимает регистрацию команд', async () => {
    const loaded = await loadCommands(moduleOf({ 'a.x': () => 1 }));
    await loaded.dispose();
    expect(loaded.ids()).toEqual([]);
    await expect(loaded.run('a.x')).rejects.toThrow(/not registered/);
  });
});
