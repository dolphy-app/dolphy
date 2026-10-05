import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type {
  OpenDialogOptions,
  PlatformShellDeps,
  SaveDialogOptions,
} from './shells/platform.ts';

/**
 * Подмена системных диалогов файла для e2e (`DOLPHY_FAKE_FILE_DIALOGS=<dir>`,
 * только в несобранном приложении): настоящие диалоги ОС из теста не нажать.
 * Управление — файлами каталога, читаются при каждом вызове:
 *
 * - `pick.txt` — путь файла, который «выберет» пользователь; нет файла или он
 *   пуст — отмена. Выбор отдаётся один раз и стирается.
 * - `save-cancel` — наличие файла означает отказ от сохранения.
 * - сохранённые файлы лежат в `saved/<имя>`;
 * - `dialogs.jsonl` — по строке на вызов с параметрами диалога (фильтры, имя).
 */
export const fakeFileDialogsOf = (
  env: Readonly<Record<string, string | undefined>>,
  packaged: boolean,
): string | undefined => {
  const dir = packaged ? undefined : env.DOLPHY_FAKE_FILE_DIALOGS;
  return dir === undefined || dir === '' ? undefined : dir;
};

const exists = async (file: string): Promise<boolean> =>
  readFile(file).then(
    () => true,
    () => false,
  );

export const createFakeFileDialogs = (
  dir: string,
): PlatformShellDeps['dialog'] => {
  const log = async (entry: object) => {
    await mkdir(dir, { recursive: true });
    await appendFile(
      path.join(dir, 'dialogs.jsonl'),
      `${JSON.stringify(entry)}\n`,
    );
  };
  return {
    showOpenDialog: async (_window, options: OpenDialogOptions) => {
      await log({ kind: 'open', ...options });
      if (options.properties.includes('openDirectory')) {
        return { canceled: true, filePaths: [] };
      }
      const pick = path.join(dir, 'pick.txt');
      const chosen = (await readFile(pick, 'utf8').catch(() => '')).trim();
      await rm(pick, { force: true });
      return chosen === ''
        ? { canceled: true, filePaths: [] }
        : { canceled: false, filePaths: [chosen] };
    },
    showSaveDialog: async (_window, options: SaveDialogOptions) => {
      await log({ kind: 'save', ...options });
      if (await exists(path.join(dir, 'save-cancel'))) {
        return { canceled: true };
      }
      const target = path.join(dir, 'saved', path.basename(options.defaultPath));
      await mkdir(path.dirname(target), { recursive: true });
      return { canceled: false, filePath: target };
    },
  };
};
