import type { Shell } from './types.ts';

interface NavigationEvent {
  preventDefault(): void;
  url: string;
  isMainFrame?: boolean;
}

export interface GuardedWebContents {
  on(
    event: 'will-navigate' | 'will-frame-navigate',
    listener: (event: NavigationEvent) => void,
  ): unknown;
  on(
    event: 'will-attach-webview',
    listener: (event: { preventDefault(): void }) => void,
  ): unknown;
  setWindowOpenHandler(handler: () => { action: 'deny' }): void;
  getURL(): string;
}

export interface PermissionSessionLike {
  setPermissionRequestHandler(
    handler: (
      webContents: unknown,
      permission: string,
      callback: (granted: boolean) => void,
    ) => void,
  ): void;
  setPermissionCheckHandler(handler: () => boolean): void;
}

export interface WebContentsGuardDeps {
  app: {
    whenReady(): Promise<unknown>;
    on(
      event: 'web-contents-created',
      listener: (event: unknown, contents: GuardedWebContents) => void,
    ): unknown;
  };
  session: { defaultSession: PermissionSessionLike };
}

/**
 * Чек-лист безопасности Electron для всего приложения, а не только главного
 * окна: сеансу отказано во всех разрешениях (камера, геолокация и т. п.), у
 * любого `webContents` — включая подкадры расширений — навигация, открытие
 * окон и `<webview>` запрещены. Единственное исключение — перезагрузка
 * текущего адреса главного кадра («Перезагрузить окно» в настройках).
 * Подкадров у приложения нет: навигация любого подкадра запрещена.
 */
export const createWebContentsGuardShell = ({
  app,
  session,
}: WebContentsGuardDeps): Shell => ({
  register: () => {
    app.on('web-contents-created', (_event, contents) => {
      const forbid = (event: NavigationEvent) => {
        if (event.isMainFrame !== false && event.url === contents.getURL()) {
          return;
        }
        event.preventDefault();
      };
      contents.on('will-navigate', forbid);
      contents.on('will-frame-navigate', forbid);
      contents.on('will-attach-webview', (event) => event.preventDefault());
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    });
    void app.whenReady().then(() => {
      const { defaultSession } = session;
      defaultSession.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      defaultSession.setPermissionCheckHandler(() => false);
    });
  },
});
