import path from 'node:path';
import type { ExtensionLogger } from '@dolphy-app/extension-api';
import {
  INSTALL_META_FILE,
  parseInstallMeta,
} from '@dolphy-app/extension-catalog';
import type { InstallMeta } from '@dolphy-app/extension-catalog';
import { isMissing } from './fs.ts';
import type { InstallerFs } from './fs.ts';

/** `.dolphy-install.json` каталога расширения; нет или повреждён — `null` (расширение считается скопированным вручную). */
export const readInstallMeta = async (
  fs: InstallerFs,
  logger: ExtensionLogger,
  extensionDir: string,
): Promise<InstallMeta | null> => {
  try {
    return parseInstallMeta(
      JSON.parse(await fs.readText(path.join(extensionDir, INSTALL_META_FILE))),
    );
  } catch (error) {
    if (isMissing(error)) return null;
    if (!(error instanceof Error)) throw error;
    logger.warn({ error, extensionDir }, 'install metadata ignored: invalid');
    return null;
  }
};
