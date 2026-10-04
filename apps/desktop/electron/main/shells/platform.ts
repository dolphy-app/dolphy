import { CHANNELS } from '../../../shared/bridge.ts';
import type { AppInfo } from '../../../shared/bridge.ts';
import type { Shell } from './types.ts';

export interface PickDirectoryEvent {
  sender: unknown;
}

export interface OpenDialogOptions {
  title?: string;
  properties: string[];
}

export interface PlatformShellDeps {
  ipcMain: {
    handle(
      channel: string,
      listener: (
        event: PickDirectoryEvent,
        options: unknown,
      ) => Promise<unknown>,
    ): unknown;
  };
  dialog: {
    showOpenDialog(
      window: unknown,
      options: OpenDialogOptions,
    ): Promise<{ canceled: boolean; filePaths: string[] }>;
  };
  fromWebContents(sender: unknown): unknown;
  appInfo(): AppInfo;
}

const titleOf = (options: unknown): string | undefined => {
  const title = (options as { title?: unknown } | null)?.title;
  return typeof title === 'string' ? title : undefined;
};

/** Диалоги и остальное платформенное — только в main (инверсия управления, `Platform`). */
export const createPlatformShell = ({
  ipcMain,
  dialog,
  fromWebContents,
  appInfo,
}: PlatformShellDeps): Shell => ({
  register: () => {
    ipcMain.handle(CHANNELS.pickDirectory, async (event, options) => {
      const title = titleOf(options);
      const { canceled, filePaths } = await dialog.showOpenDialog(
        fromWebContents(event.sender),
        {
          ...(title === undefined ? {} : { title }),
          properties: ['openDirectory', 'createDirectory'],
        },
      );
      return canceled ? null : (filePaths[0] ?? null);
    });
    ipcMain.handle(CHANNELS.appInfo, async () => appInfo());
  },
});
