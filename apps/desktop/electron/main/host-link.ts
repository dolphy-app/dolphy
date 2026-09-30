import type { HostProcessLike, MessageChannelLike } from './supervisor.ts';

export interface HostLinkDeps {
  MessageChannelMain: new () => MessageChannelLike;
}

export interface HostLink {
  setEngine(host: HostProcessLike | null): void;
  setExtHost(host: HostProcessLike | null): void;
}

/**
 * Связывает хост движка и хост расширений прямым каналом: каждый раз, когда
 * один из них (пере)запустился при живом втором, оба получают свежий порт.
 * Старый порт закрывается стороной, которая принимает новый.
 */
export const createHostLink = ({
  MessageChannelMain,
}: HostLinkDeps): HostLink => {
  let engine: HostProcessLike | null = null;
  let extHost: HostProcessLike | null = null;

  const link = () => {
    if (!engine || !extHost) return;
    const { port1, port2 } = new MessageChannelMain();
    engine.postMessage({ type: 'ext-port' }, [port1]);
    extHost.postMessage({ type: 'connect' }, [port2]);
  };

  return {
    setEngine: (host) => {
      engine = host;
      if (host) link();
    },
    setExtHost: (host) => {
      extHost = host;
      if (host) link();
    },
  };
};
