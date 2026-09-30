import { describe, expect, it } from 'vitest';
import { createHostLink } from '../electron/main/host-link.ts';
import type {
  HostProcessLike,
  MessageChannelLike,
} from '../electron/main/supervisor.ts';

interface Posted {
  message: unknown;
  transfer?: unknown[] | undefined;
}

const createHost = () => {
  const posted: Posted[] = [];
  const host = {
    posted,
    postMessage: (message: unknown, transfer?: unknown[]) => {
      posted.push({ message, transfer });
    },
  };
  return host as typeof host & HostProcessLike;
};

const setup = () => {
  let channels = 0;
  class FakeChannel implements MessageChannelLike {
    readonly port1 = { side: 1, channel: ++channels };
    readonly port2 = { side: 2, channel: channels };
  }
  return { link: createHostLink({ MessageChannelMain: FakeChannel }) };
};

describe('host link', () => {
  it('связывает хосты только когда есть оба', () => {
    const { link } = setup();
    const engine = createHost();
    const ext = createHost();
    link.setEngine(engine);
    expect(engine.posted).toEqual([]);
    link.setExtHost(ext);
    expect(engine.posted).toEqual([
      {
        message: { type: 'ext-port' },
        transfer: [{ side: 1, channel: 1 }],
      },
    ]);
    expect(ext.posted).toEqual([
      { message: { type: 'connect' }, transfer: [{ side: 2, channel: 1 }] },
    ]);
  });

  it('перезапуск любого хоста создаёт новую пару портов', () => {
    const { link } = setup();
    const engine = createHost();
    const ext = createHost();
    link.setEngine(engine);
    link.setExtHost(ext);
    const engine2 = createHost();
    link.setEngine(null);
    link.setEngine(engine2);
    expect(engine2.posted[0]?.transfer).toEqual([{ side: 1, channel: 2 }]);
    expect(ext.posted[1]?.transfer).toEqual([{ side: 2, channel: 2 }]);
    const ext2 = createHost();
    link.setExtHost(null);
    link.setExtHost(ext2);
    expect(engine2.posted[1]?.transfer).toEqual([{ side: 1, channel: 3 }]);
    expect(ext2.posted[0]?.transfer).toEqual([{ side: 2, channel: 3 }]);
  });

  it('null не создаёт каналов и отвязывает хост', () => {
    const { link } = setup();
    const engine = createHost();
    const ext = createHost();
    link.setEngine(engine);
    link.setExtHost(ext);
    link.setExtHost(null);
    link.setEngine(createHost());
    expect(ext.posted).toHaveLength(1);
  });
});
