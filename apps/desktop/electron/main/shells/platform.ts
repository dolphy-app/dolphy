import path from 'node:path';
import { MAX_EXTENSION_TRANSFER_BYTES } from '@dolphy-app/engine-contract';
import { CHANNELS } from '../../../shared/bridge.ts';
import type { AppInfo, PickedFile } from '../../../shared/bridge.ts';
import type { Shell } from './types.ts';

export interface PickDirectoryEvent {
  sender: unknown;
}

export interface OpenDialogOptions {
  title?: string;
  properties: string[];
  filters?: { name: string; extensions: string[] }[];
}

export interface SaveDialogOptions {
  title?: string;
  defaultPath: string;
}

/** Файловая система для диалогов файла: байты читает и пишет только main. */
export interface TransferFiles {
  size(filePath: string): Promise<number>;
  read(filePath: string): Promise<Uint8Array>;
  write(filePath: string, bytes: Uint8Array): Promise<void>;
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
    showSaveDialog(
      window: unknown,
      options: SaveDialogOptions,
    ): Promise<{ canceled: boolean; filePath?: string }>;
  };
  files: TransferFiles;
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

const ACCEPT_PATTERN = /^\.[a-z0-9]{1,16}$/;
const MAX_ACCEPT = 8;

/** Имя без каталога для обеих ОС: окно присылает строку, путь из неё не берётся. */
const baseNameOf = (value: string): string =>
  value.slice(Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\')) + 1);

const parsePickOptions = (
  options: unknown,
): { accept: string[]; title?: string } => {
  const { accept, title } = (options ?? {}) as {
    accept?: unknown;
    title?: unknown;
  };
  if (
    !Array.isArray(accept) ||
    accept.length < 1 ||
    accept.length > MAX_ACCEPT ||
    !accept.every(
      (item) => typeof item === 'string' && ACCEPT_PATTERN.test(item),
    )
  ) {
    throw new TypeError('pickFile expects 1-8 lowercase extensions like ".csv"');
  }
  return {
    accept: accept as string[],
    ...(typeof title === 'string' ? { title } : {}),
  };
};

const parseSaveOptions = (
  options: unknown,
): { name: string; bytes: Uint8Array } => {
  const { suggestedName, bytes } = (options ?? {}) as {
    suggestedName?: unknown;
    bytes?: unknown;
  };
  if (typeof suggestedName !== 'string' || !(bytes instanceof Uint8Array)) {
    throw new TypeError('saveFile expects a name and bytes');
  }
  if (bytes.byteLength > MAX_EXTENSION_TRANSFER_BYTES) {
    throw new TypeError('saveFile expects at most 20 MiB');
  }
  const name = baseNameOf(suggestedName).replace(/[\u0000-\u001f]/g, '');
  if (name === '' || name === '.' || name === '..') {
    throw new TypeError('saveFile expects a file name');
  }
  return { name, bytes };
};

/** Диалоги и остальное платформенное — только в main (инверсия управления, `Platform`). */
export const createPlatformShell = ({
  ipcMain,
  dialog,
  files,
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
    ipcMain.handle(
      CHANNELS.pickFile,
      async (event, options): Promise<PickedFile | null> => {
        const { accept, title } = parsePickOptions(options);
        const { canceled, filePaths } = await dialog.showOpenDialog(
          fromWebContents(event.sender),
          {
            ...(title === undefined ? {} : { title }),
            properties: ['openFile'],
            filters: [
              {
                name: accept.join(', '),
                extensions: accept.map((item) => item.slice(1)),
              },
            ],
          },
        );
        const filePath = canceled ? undefined : filePaths[0];
        if (filePath === undefined) return null;
        const name = path.basename(filePath);
        if (!accept.includes(path.extname(name).toLowerCase())) {
          return { status: 'unsupported', name };
        }
        if ((await files.size(filePath)) > MAX_EXTENSION_TRANSFER_BYTES) {
          return { status: 'too-large', name };
        }
        const bytes = await files.read(filePath);
        // файл мог вырасти между проверкой и чтением
        if (bytes.byteLength > MAX_EXTENSION_TRANSFER_BYTES) {
          return { status: 'too-large', name };
        }
        return { status: 'picked', name, bytes: new Uint8Array(bytes) };
      },
    );
    ipcMain.handle(CHANNELS.saveFile, async (event, options) => {
      const { name, bytes } = parseSaveOptions(options);
      const { canceled, filePath } = await dialog.showSaveDialog(
        fromWebContents(event.sender),
        { defaultPath: name },
      );
      if (canceled || filePath === undefined) return 'canceled';
      await files.write(filePath, bytes);
      return 'saved';
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
