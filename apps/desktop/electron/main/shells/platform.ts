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
  clipboard: { writeText(text: string): void };
}

/** Потолок текста, который окно кладёт в буфер обмена. */
export const MAX_COPY_CHARS = 1024 * 1024;

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
  clipboard,
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
    ipcMain.handle(CHANNELS.copyText, async (_event, text) => {
      if (typeof text !== 'string' || text.length > MAX_COPY_CHARS) {
        throw new TypeError('copyText expects a string of at most 1 MiB');
      }
      clipboard.writeText(text);
    });
  },
});
