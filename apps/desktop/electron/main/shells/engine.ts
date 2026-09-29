import { CHANNELS } from '../../../shared/bridge.ts';
import type { Supervisor, WebContentsLike } from '../supervisor.ts';
import type { Shell } from './types.ts';

export interface EngineConnectEvent {
  sender: WebContentsLike & { mainFrame: unknown };
  senderFrame: unknown;
}

export interface EngineShellDeps {
  ipcMain: {
    on(channel: string, listener: (event: EngineConnectEvent) => void): unknown;
  };
  supervisor: Pick<Supervisor, 'connect'>;
}

/** Единственная точка выдачи порта движка окну. */
export const createEngineShell = ({
  ipcMain,
  supervisor,
}: EngineShellDeps): Shell => ({
  register: () => {
    ipcMain.on(CHANNELS.engineConnect, (event) => {
      if (event.senderFrame !== event.sender.mainFrame) return; // только верхний фрейм
      supervisor.connect(event.sender);
    });
  },
});
