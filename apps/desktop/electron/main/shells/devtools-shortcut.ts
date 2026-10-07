import type { Shell } from './types.ts';

/** Часть `Electron.Input`, по которой узнаётся сочетание. */
export interface ShortcutInput {
  type: string;
  /** `KeyboardEvent.code`: не зависит от раскладки и от символа, который даёт Option на macOS. */
  code: string;
  isAutoRepeat: boolean;
  control: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

export interface DevToolsWebContentsLike {
  on(
    event: 'before-input-event',
    listener: (event: { preventDefault(): void }, input: ShortcutInput) => void,
  ): unknown;
  toggleDevTools(): void;
}

export interface DevToolsShortcutDeps {
  app: {
    on(
      event: 'browser-window-created',
      listener: (
        event: unknown,
        window: { webContents: DevToolsWebContentsLike },
      ) => void,
    ): unknown;
  };
  /** Каталог разработчика (`DOLPHY_DEV_EXTENSIONS`); без него оболочка ничего не регистрирует. */
  devExtensionsDir?: string;
  platform: string;
}

/** `F12`, `Cmd+Alt+I` (macOS), `Ctrl+Shift+I`. */
export const isDevToolsShortcut = (
  input: ShortcutInput,
  platform: string,
): boolean => {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return false;
  const { control, shift, alt, meta } = input;
  if (input.code === 'F12') return !control && !shift && !alt && !meta;
  if (input.code !== 'KeyI') return false;
  if (platform === 'darwin' && meta && alt && !control && !shift) return true;
  return control && shift && !alt && !meta;
};

/**
 * Режим разработчика: DevTools главного окна переключаются сочетаниями
 * клавиш, в том числе в упакованной сборке (там `openDevTools()` не вызывается
 * и меню приложения нет). Компоненты расширений живут в дереве окна, отдельных
 * контекстов у них нет. Без `DOLPHY_DEV_EXTENSIONS` оболочка
 * не подписывается на окна, и сочетания ничего не делают.
 */
export const createDevToolsShortcutShell = (
  deps: DevToolsShortcutDeps,
): Shell => ({
  register: () => {
    if (!deps.devExtensionsDir) return;
    deps.app.on('browser-window-created', (_event, window) => {
      const { webContents } = window;
      webContents.on('before-input-event', (event, input) => {
        if (!isDevToolsShortcut(input, deps.platform)) return;
        event.preventDefault();
        webContents.toggleDevTools();
      });
    });
  },
});
