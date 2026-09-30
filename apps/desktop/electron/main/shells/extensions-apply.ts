import { CHANNELS } from '../../../shared/bridge.ts';
import type { MainLogger } from '../logger.ts';
import { restartExtensionHosts } from './extension-reload.ts';
import type { ExtensionReloadDeps } from './extension-reload.ts';
import type { Shell } from './types.ts';

export interface ExtensionsApplyEvent {
  sender: { mainFrame: unknown };
  senderFrame: unknown;
}

export interface ExtensionsApplyDeps extends ExtensionReloadDeps {
  ipcMain: {
    handle(
      channel: string,
      listener: (event: ExtensionsApplyEvent) => Promise<void>,
    ): unknown;
  };
  timers: { setTimeout(callback: () => void, ms: number): unknown };
  logger: MainLogger;
}

/**
 * «Применить изменения расширений»: окно просит перезапустить хосты и
 * перезагрузиться. Перезагрузка откладывается на следующий такт, чтобы ответ
 * `invoke` успел уйти до того, как окно исчезнет. Только верхний фрейм.
 */
export const createExtensionsApplyShell = ({
  ipcMain,
  timers,
  logger,
  ...reload
}: ExtensionsApplyDeps): Shell => ({
  register: () => {
    ipcMain.handle(CHANNELS.applyExtensions, async (event) => {
      if (event.senderFrame !== event.sender.mainFrame) return;
      logger.info({}, 'extension changes requested, restarting hosts');
      timers.setTimeout(() => restartExtensionHosts(reload), 0);
    });
  },
});
