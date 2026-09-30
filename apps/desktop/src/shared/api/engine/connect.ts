import { createEngineClient, fromDomPort } from '@spirula/engine-rpc/client';
import type { DomPortLike } from '@spirula/engine-rpc/client';
import type { LearningEngine } from '@spirula/engine-contract';
import { CHANNELS } from '../../../../shared/bridge.ts';

/**
 * Ждёт порт от main (через preload) и рукопожатие `engine.hello`. Каждый
 * следующий порт (перезапуск хоста, перезагрузка) переподключает тот же клиент.
 */
export const connectEngine = () =>
  new Promise<LearningEngine>((resolve, reject) => {
    const client = createEngineClient();
    let first = true;
    window.addEventListener('message', async (event) => {
      if (event.source !== window || event.data !== CHANNELS.enginePort) return;
      const [port] = event.ports;
      if (!port) return;
      try {
        await client.attach(fromDomPort(port as unknown as DomPortLike));
        if (first) {
          first = false;
          resolve(client.engine);
        }
      } catch (error) {
        if (first) reject(error);
        else console.error(error); // переподключение не удалось
      }
    });
    window.spirula.engine.connect();
  });
