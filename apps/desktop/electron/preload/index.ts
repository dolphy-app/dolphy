import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from '../../shared/bridge.ts';
import type { DolphyBridge } from '../../shared/bridge.ts';
import { SMOKE_ARGUMENT, SMOKE_CHANNELS } from '../../shared/smoke.ts';

const windowLoaded = new Promise<void>((resolve) => {
  window.addEventListener('load', () => resolve(), { once: true });
});

// порт до main world доходит только так: main → preload → window.postMessage
ipcRenderer.on(CHANNELS.enginePort, async (event) => {
  await windowLoaded; // страница должна успеть подписаться на message
  window.postMessage(CHANNELS.enginePort, '*', [...event.ports]);
});

const bridge: DolphyBridge = {
  engine: { connect: () => ipcRenderer.send(CHANNELS.engineConnect) },
  platform: {
    pickDirectory: (options) => {
      const title =
        typeof options?.title === 'string' ? options.title : undefined;
      return ipcRenderer.invoke(CHANNELS.pickDirectory, { title });
    },
    pickFile: (options) =>
      ipcRenderer.invoke(CHANNELS.pickFile, {
        accept: options.accept,
        title: options.title,
      }),
    saveFile: (options) =>
      ipcRenderer.invoke(CHANNELS.saveFile, {
        suggestedName: options.suggestedName,
        bytes: options.bytes,
      }),
    appInfo: () => ipcRenderer.invoke(CHANNELS.appInfo),
    copyText: (text) => ipcRenderer.invoke(CHANNELS.copyText, text),
  },
  deepLink: {
    onInstall: (listener) => {
      const handle = (_event: unknown, payload: unknown) => {
        const id = (payload as { id?: unknown } | null)?.id;
        if (typeof id === 'string') listener({ id });
      };
      ipcRenderer.on(CHANNELS.deepLinkInstall, handle);
      // после подписки main отдаёт ссылки, принятые до загрузки окна
      ipcRenderer.send(CHANNELS.deepLinkReady);
      return () => {
        ipcRenderer.removeListener(CHANNELS.deepLinkInstall, handle);
      };
    },
  },
  ...(__DOLPHY_SMOKE_BUILD__ && process.argv.includes(SMOKE_ARGUMENT)
    ? {
        smoke: {
          report: (result: unknown) =>
            ipcRenderer.send(SMOKE_CHANNELS.report, result),
          killHost: () => ipcRenderer.invoke(SMOKE_CHANNELS.killHost),
        },
      }
    : {}),
};
contextBridge.exposeInMainWorld('dolphy', bridge);
