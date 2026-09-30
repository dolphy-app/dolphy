import type { EngineConfig } from '@lms/engine-contract';
import type { ExtensionRoot } from '@lms/extension-host';

/** Корни расширений в порядке приоритета: сначала поставка, затем пользовательский (побеждает). */
export const extensionRoots = ({
  bundledExtensionsDir,
  userExtensionsDir,
}: Pick<
  EngineConfig,
  'bundledExtensionsDir' | 'userExtensionsDir'
>): ExtensionRoot[] => [
  ...(bundledExtensionsDir
    ? [{ dir: bundledExtensionsDir, origin: 'bundled' as const }]
    : []),
  ...(userExtensionsDir
    ? [{ dir: userExtensionsDir, origin: 'user' as const }]
    : []),
];
