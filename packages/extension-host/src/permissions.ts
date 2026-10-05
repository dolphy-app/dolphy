import type { ExtensionPermission } from '@dolphy-app/extension-api';

/**
 * Разрешение → флаги режима разрешений Node для ограниченного процесса.
 * Единственное место, где объявленное в манифесте превращается в возможности.
 *
 * - `library.read` — не флаг Node, а возможность контекста: родитель отвечает
 *   на запросы прокси `ctx.library`, пока разрешение объявлено.
 * - `learning.events` — тоже не флаг Node: события обучения доставляет
 *   движок, пока разрешение объявлено и событие есть в `contributes.events`.
 * - `learning.stats` — тоже не флаг Node: `ctx.stats` отвечает движок, пока
 *   разрешение объявлено (проверка в службе `stats` движка, а не в процессе).
 * - `notifications` — тоже не флаг Node: уведомление показывает main по
 *   запросу движка, пока разрешение объявлено (проверка в службе движка).
 * - `network` — только объявляется и показывается пользователю: режим
 *   разрешений Node не умеет ограничивать сеть.
 */
const GRANT_FLAGS: Readonly<Record<ExtensionPermission, readonly string[]>> = {
  'library.read': [],
  'process.spawn': ['--allow-child-process'],
  'worker.threads': ['--allow-worker'],
  'native.addons': ['--allow-addons'],
  network: [],
  'learning.events': [],
  'learning.stats': [],
  notifications: [],
};

export const grantFlags = (
  permissions: readonly ExtensionPermission[],
): string[] => [
  ...new Set(permissions.flatMap((permission) => GRANT_FLAGS[permission])),
];

/** `--permission` с Node 22.13, до этого — `--experimental-permission`. */
export const permissionFlag = (nodeVersion: string): string => {
  const [major = 0, minor = 0] = nodeVersion.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 13)
    ? '--permission'
    : '--experimental-permission';
};

export interface RestrictedLaunch {
  /** Реальные (без симлинков) каталоги, доступные на чтение: расширение и сборка дочернего процесса. */
  readDirs: readonly string[];
  entry: string;
  permissions: readonly ExtensionPermission[];
  nodeVersion: string;
}

/** Аргументы `process.execPath` для ограниченного дочернего процесса. */
export const restrictedArgs = ({
  readDirs,
  entry,
  permissions,
  nodeVersion,
}: RestrictedLaunch): string[] => [
  permissionFlag(nodeVersion),
  ...readDirs.map((dir) => `--allow-fs-read=${dir}`),
  ...grantFlags(permissions),
  entry,
];

/** Окружение ограниченного процесса: ровно одна переменная, без секретов приложения. */
export const RESTRICTED_ENV: Readonly<Record<string, string>> = {
  ELECTRON_RUN_AS_NODE: '1',
};
