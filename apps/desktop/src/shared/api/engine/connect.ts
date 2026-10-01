import { createEngineClient, fromDomPort } from '@dolphy-app/engine-rpc/client';
import type { DomPortLike } from '@dolphy-app/engine-rpc/client';
import type { LearningEngine } from '@dolphy-app/engine-contract';
import { CHANNELS } from '../../../../shared/bridge.ts';

export interface EngineConnection {
  engine: LearningEngine;
  /**
   * Вызывается после каждого переподключения (перезапуск хоста движка), но не
   * после первого подключения. Возвращает функцию отписки.
   */
  onReconnect(listener: () => void): () => void;
}

/**
 * Ждёт порт от main (через preload) и рукопожатие `engine.hello`. Каждый
 * следующий порт (перезапуск хоста, перезагрузка) переподключает тот же клиент.
 */
export const connectEngine = () =>
  new Promise<EngineConnection>((resolve, reject) => {
    const client = createEngineClient();
    const listeners = new Set<() => void>();
    let first = true;
    window.addEventListener('message', async (event) => {
      if (event.source !== window || event.data !== CHANNELS.enginePort) return;
      const [port] = event.ports;
      if (!port) return;
      try {
        await client.attach(fromDomPort(port as unknown as DomPortLike));
        if (first) {
          first = false;
          resolve({
            engine: client.engine,
            onReconnect: (listener) => {
              listeners.add(listener);
              return () => void listeners.delete(listener);
            },
          });
        } else {
          for (const listener of [...listeners]) listener();
        }
      } catch (error) {
        if (first) reject(error);
        else console.error(error); // переподключение не удалось
      }
    });
    window.dolphy.engine.connect();
  });
