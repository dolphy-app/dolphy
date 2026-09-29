import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from '../../shared/bridge.ts';
import type { LmsBridge } from '../../shared/bridge.ts';
import { SMOKE_ARGUMENT, SMOKE_CHANNELS } from '../../shared/smoke.ts';

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
  ...(__LMS_SMOKE_BUILD__ && process.argv.includes(SMOKE_ARGUMENT)
    ? {
        smoke: {
          report: (result: unknown) =>
            ipcRenderer.send(SMOKE_CHANNELS.report, result),
          killHost: () => ipcRenderer.invoke(SMOKE_CHANNELS.killHost),
        },
      }
    : {}),
};
contextBridge.exposeInMainWorld('lms', bridge);
