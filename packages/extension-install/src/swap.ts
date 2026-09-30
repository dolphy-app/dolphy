import path from 'node:path';
import type { ExtensionLogger } from '@spirula-app/extension-api';
import type { InstallerFs } from './fs.ts';

export interface SwapOptions {
  fs: InstallerFs;
  logger: ExtensionLogger;
  /** Готовый каталог. */
  staging: string;
  /** `<extensionsDir>/<id>`. */
  target: string;
  /** Куда переместить прежний каталог, если он есть. */
  trash: string;
}

/**
 * Заменяет `target` каталогом `staging`: прежний уходит в `trash`, новый встаёт
 * на его место; при сбое второго шага прежний возвращается. Возвращает `trash`,
 * если прежний каталог был, иначе `null`.
 */
export const swapDirectory = async (
  options: SwapOptions,
): Promise<string | null> => {
  const { fs, logger, staging, target, trash } = options;
  const hadPrevious = (await fs.stat(target)) !== null;
  if (hadPrevious) {
    await fs.mkdir(path.dirname(trash));
    await fs.rename(target, trash);
  }
  try {
    await fs.rename(staging, target);
  } catch (error) {
    if (hadPrevious) {
      try {
        await fs.rename(trash, target);
      } catch (restoreError) {
        logger.error(
          { error: restoreError, target, trash },
          'previous extension directory could not be restored',
        );
      }
    }
    throw error;
  }
  return hadPrevious ? trash : null;
};
