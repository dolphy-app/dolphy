import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { fromDomPort, type DomPortLike } from '../src/client/index.ts';
import { fromNodePort, type NodePortLike } from '../src/host/index.ts';

class FakeNodePort extends EventEmitter {
  readonly sent: unknown[] = [];
  started = false;
  closed = false;
  listenersAtStart = -1;
  postMessage(message: unknown): void {
    this.sent.push(message);
  }
  start(): void {
    this.started = true;
    this.listenersAtStart = this.listenerCount('message');
  }
  close(): void {
    this.closed = true;
  }
}

describe('fromNodePort', () => {
  it('unwraps event.data, starts after the listener is set, posts through', () => {
    const port = new FakeNodePort();
    const endpoint = fromNodePort(port as unknown as NodePortLike);
    const received: unknown[] = [];
    endpoint.onMessage((message) => received.push(message));
    expect(port.started).toBe(true);
    expect(port.listenersAtStart).toBe(1);
    port.emit('message', { data: { id: '1' } });
    expect(received).toEqual([{ id: '1' }]);
    endpoint.post({ ok: true });
    expect(port.sent).toEqual([{ ok: true }]);
  });

  it('notifies close listeners once for a remote close and for a local close', () => {
    const remote = new FakeNodePort();
    const endpointA = fromNodePort(remote as unknown as NodePortLike);
    let a = 0;
    endpointA.onClose(() => (a += 1));
    remote.emit('close');
    endpointA.close();
    expect(a).toBe(1);
    expect(remote.closed).toBe(false); // уже закрыт удалённо

    const local = new FakeNodePort();
    const endpointB = fromNodePort(local as unknown as NodePortLike);
    let b = 0;
    endpointB.onClose(() => (b += 1));
    endpointB.close();
    local.emit('close');
    expect(b).toBe(1);
    expect(local.closed).toBe(true);
    endpointB.post({ dropped: true });
    expect(local.sent).toEqual([]);
  });
});

describe('fromDomPort', () => {
  const createDomPort = () => {
    const closeListeners: Array<() => void> = [];
    const port: DomPortLike & {
      sent: unknown[];
      started: boolean;
      closed: boolean;
    } = {
      onmessage: null,
      sent: [],
      started: false,
      closed: false,
      postMessage(message) {
        this.sent.push(message);
      },
      addEventListener(_type, listener) {
        closeListeners.push(listener);
      },
      start() {
        this.started = true;
      },
      close() {
        this.closed = true;
      },
    };
    return { port, fireClose: () => closeListeners.forEach((l) => l()) };
  };

  it('routes onmessage data and posts through the port', () => {
    const { port } = createDomPort();
    const endpoint = fromDomPort(port);
    const received: unknown[] = [];
    endpoint.onMessage((message) => received.push(message));
    expect(port.started).toBe(true);
    port.onmessage?.({ data: 'hello' });
    expect(received).toEqual(['hello']);
    endpoint.post({ a: 1 });
    expect(port.sent).toEqual([{ a: 1 }]);
  });

  it('close event and local close notify listeners once', () => {
    const { port, fireClose } = createDomPort();
    const endpoint = fromDomPort(port);
    let count = 0;
    endpoint.onClose(() => (count += 1));
    fireClose();
    endpoint.close();
    fireClose();
    expect(count).toBe(1);
  });
});
