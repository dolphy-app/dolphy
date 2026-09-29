import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, SMOKE_ARGUMENT } from '../../shared/bridge.ts';
import type { LmsBridge } from '../../shared/bridge.ts';

const windowLoaded = new Promise<void>((resolve) => {
  window.addEventListener('load', () => resolve(), { once: true });
});

// порт до main world доходит только так: main → preload → window.postMessage
ipcRenderer.on(CHANNELS.enginePort, async (event) => {
  await windowLoaded; // страница должна успеть подписаться на message
  window.postMessage(CHANNELS.enginePort, '*', [...event.ports]);
});

const bridge: LmsBridge = {
  engine: { connect: () => ipcRenderer.send(CHANNELS.engineConnect) },
  platform: {
    pickDirectory: (options) => {
      const title =
        typeof options?.title === 'string' ? options.title : undefined;
      return ipcRenderer.invoke(CHANNELS.pickDirectory, { title });
    },
  },
  ...(process.argv.includes(SMOKE_ARGUMENT)
    ? {
        smoke: {
          report: (result: unknown) =>
            ipcRenderer.send(CHANNELS.smokeReport, result),
          killHost: () => ipcRenderer.invoke(CHANNELS.smokeKillHost),
        },
      }
    : {}),
};
contextBridge.exposeInMainWorld('lms', bridge);
