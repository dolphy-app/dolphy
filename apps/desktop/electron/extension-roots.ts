import type { EngineConfig } from '@dolphy-app/engine-contract';
import type { ExtensionRoot } from '@dolphy-app/extension-host';

/** Корни расширений в порядке приоритета: поставка, пользовательский, затем каталог разработчика (побеждает). */
export const extensionRoots = ({
  bundledExtensionsDir,
  userExtensionsDir,
  devExtensionsDir,
}: Pick<
  EngineConfig,
  'bundledExtensionsDir' | 'userExtensionsDir' | 'devExtensionsDir'
>): ExtensionRoot[] => [
  ...(bundledExtensionsDir
    ? [{ dir: bundledExtensionsDir, origin: 'bundled' as const }]
    : []),
  ...(userExtensionsDir
    ? [{ dir: userExtensionsDir, origin: 'user' as const }]
    : []),
  ...(devExtensionsDir
    ? [{ dir: devExtensionsDir, origin: 'dev' as const }]
    : []),
];
