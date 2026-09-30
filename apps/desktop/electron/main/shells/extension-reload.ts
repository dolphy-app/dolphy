export interface ExtensionReloadDeps {
  /** Перезапуск хоста движка и хоста расширений (не считается падением). */
  restartHosts(): void;
  windows(): readonly { reloadIgnoringCache(): void }[];
}

/**
 * Применяет изменения на диске в каталогах расширений: хосты читают
 * расширения только при запуске, поэтому перезапускаются оба, а окна
 * перезагружаются и получают новые порты и вклады. Общий путь режима
 * разработчика и кнопки «Применить» после установки из каталога.
 */
export const restartExtensionHosts = ({
  restartHosts,
  windows,
}: ExtensionReloadDeps): void => {
  restartHosts();
  for (const win of windows()) win.reloadIgnoringCache();
};
