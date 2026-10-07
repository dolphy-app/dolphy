import { describe, expect, it } from 'vitest';
import {
  EXTENSION_COMMAND_LIMITS,
  defineServer,
  notify,
  openPanel,
  type CommandHandler,
} from '../src/index.ts';
import { createTestServer } from '../src/testing.ts';

const serverOf = (handlers: Record<string, CommandHandler>) =>
  createTestServer(
    defineServer((s) => {
      for (const [id, run] of Object.entries(handlers)) {
        s.registerCommand({ id, title: id, run });
      }
    }),
  );

describe('notify / openPanel', () => {
  it('return exactly the effect; openPanel without props has no props key', () => {
    expect(notify('готово')).toEqual({ notify: 'готово' });
    expect(openPanel('p')).toStrictEqual({ openPanel: 'p' });
    expect(openPanel('p', { a: 1 })).toStrictEqual({
      openPanel: 'p',
      props: { a: 1 },
    });
    expect(openPanel('p', 0)).toStrictEqual({ openPanel: 'p', props: 0 });
  });

  it('pass through commands.run as effects', async () => {
    const server = await serverOf({
      'a.notify': () => notify('hi'),
      'a.open': () => openPanel('p'),
      'a.props': () => openPanel('p', [1, 2]),
    });
    expect(await server.commands.run('a.notify')).toEqual({
      kind: 'notify',
      text: 'hi',
    });
    expect(await server.commands.run('a.open')).toStrictEqual({
      kind: 'openPanel',
      panelId: 'p',
    });
    expect(await server.commands.run('a.props')).toEqual({
      kind: 'openPanel',
      panelId: 'p',
      props: [1, 2],
    });
  });
});

describe('createTestServer: commands', () => {
  it('normalizes every kind of result', async () => {
    const server = await serverOf({
      'a.none': () => undefined,
      'a.null': () => null,
      'a.data': () => ({ rows: [1, 2], skipped: undefined }) as never,
      'a.async': async () => 'text',
    });
    expect(await server.commands.run('a.none')).toEqual({ kind: 'none' });
    expect(await server.commands.run('a.null')).toEqual({ kind: 'none' });
    expect(await server.commands.run('a.data')).toEqual({
      kind: 'data',
      value: { rows: [1, 2] },
    });
    expect(await server.commands.run('a.async')).toEqual({
      kind: 'data',
      value: 'text',
    });
  });

  it('an unregistered command rejects run', async () => {
    const server = await serverOf({ 'a.x': () => 1 });
    await expect(server.commands.run('a.y')).rejects.toThrow(
      "command 'a.y' was not registered",
    );
  });

  it('invalid results are rejected as invalid command result', async () => {
    const server = await serverOf({
      'a.big': () => 'x'.repeat(EXTENSION_COMMAND_LIMITS.resultBytes),
      'a.mixed': () => ({ notify: 'x', extra: 1 }) as never,
      'a.fn': () => (() => 1) as never,
      'a.bigint': () => 5n as never,
    });
    for (const id of ['a.big', 'a.mixed', 'a.fn', 'a.bigint']) {
      await expect(server.commands.run(id)).rejects.toThrow(
        /^invalid command result: /,
      );
    }
  });

  it('args bounds: exactly 200000 JSON characters passes, more does not', async () => {
    const received: unknown[] = [];
    const server = await serverOf({
      'a.echo': (args) => {
        received.push(args);
      },
    });
    const exact = 'a'.repeat(EXTENSION_COMMAND_LIMITS.argsChars - 2); // + two JSON quotes
    await server.commands.run('a.echo', exact);
    expect(received).toEqual([exact]);
    await expect(server.commands.run('a.echo', `${exact}a`)).rejects.toThrow(
      /args/,
    );
    expect(received).toHaveLength(1);
  });

  it('the handler gets undefined without args and JSON with args', async () => {
    const received: unknown[] = [];
    const server = await serverOf({
      'a.echo': (args) => {
        received.push(args);
      },
    });
    await server.commands.run('a.echo');
    await server.commands.run('a.echo', { n: 1 });
    expect(received).toEqual([undefined, { n: 1 }]);
  });

  it('a handler failure reaches the caller as is', async () => {
    const failure = new Error('handler bug');
    const server = await serverOf({
      'a.fail': () => {
        throw failure;
      },
    });
    await expect(server.commands.run('a.fail')).rejects.toBe(failure);
  });

  it('a command can use the storage the entry shares with its handlers', async () => {
    const server = await createTestServer(
      defineServer((s) => {
        s.registerCommand({
          id: 'a.count',
          title: 'Count',
          run: async () => {
            const count = ((await s.storage.get<number>('count')) ?? 0) + 1;
            await s.storage.set('count', count);
            return count;
          },
        });
      }),
    );
    await server.commands.run('a.count');
    expect(await server.commands.run('a.count')).toEqual({
      kind: 'data',
      value: 2,
    });
  });

  it('keybindings, palette and icon reach the snapshot with the defaults applied', async () => {
    const server = await createTestServer(
      defineServer((s) => {
        s.registerCommand({
          id: 'a.k',
          title: 'K',
          palette: false,
          icon: 'bell',
          when: "route == 'courses'",
          keybindings: [{ key: 'Mod+K', mac: 'Cmd+K' }],
          run: () => undefined,
        });
      }),
    );
    expect(server.registration.commands[0]).toMatchObject({
      palette: false,
      icon: 'bell',
      when: "route == 'courses'",
      keybindings: [
        { key: 'Mod+K', mac: 'Cmd+K', windows: null, linux: null, when: null },
      ],
    });
  });
});
