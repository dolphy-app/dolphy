import { describe, expect, it, vi } from 'vitest';
import { createEngineShell } from '../electron/main/shells/engine.ts';
import type { EngineConnectEvent } from '../electron/main/shells/engine.ts';
import { createLifecycleShell } from '../electron/main/shells/lifecycle.ts';
import { createPlatformShell } from '../electron/main/shells/platform.ts';
import type { PickDirectoryEvent } from '../electron/main/shells/platform.ts';
import { createWebContentsGuardShell } from '../electron/main/shells/web-contents-guard.ts';
import { createWindowShell } from '../electron/main/shells/window.ts';
import type {
  BrowserWindowLike,
  WindowOptions,
} from '../electron/main/shells/window.ts';

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

describe('engine shell', () => {
  const setup = () => {
    let listener: ((event: EngineConnectEvent) => void) | null = null;
    const connect = vi.fn();
    createEngineShell({
      ipcMain: {
        on: (channel, handler) => {
          expect(channel).toBe('engine:connect');
          listener = handler;
        },
      },
      supervisor: { connect },
    }).register();
    const emit = (event: EngineConnectEvent) => listener?.(event);
    return { emit, connect };
  };
  const sender = (mainFrame: unknown) =>
    ({ id: 1, mainFrame }) as unknown as EngineConnectEvent['sender'];

  it('выдаёт порт запросу из верхнего фрейма', () => {
    const { emit, connect } = setup();
    const frame = {};
    const webContents = sender(frame);
    emit({ sender: webContents, senderFrame: frame });
    expect(connect).toHaveBeenCalledWith(webContents);
  });

  it('игнорирует запрос из вложенного фрейма', () => {
    const { emit, connect } = setup();
    emit({ sender: sender({}), senderFrame: {} });
    expect(connect).not.toHaveBeenCalled();
  });
});

const INFO = {
  appVersion: '1.2.3',
  electron: '44.0.0',
  chrome: '140.0.0',
  node: '22.12.0',
  platform: 'darwin',
  arch: 'arm64',
};

describe('platform shell', () => {
  const setup = (dialogResult: { canceled: boolean; filePaths: string[] }) => {
    const handlers = new Map<
      string,
      (e: PickDirectoryEvent, options: unknown) => Promise<unknown>
    >();
    const showOpenDialog = vi.fn(async () => dialogResult);
    createPlatformShell({
      ipcMain: {
        handle: (channel, listener) => handlers.set(channel, listener),
      },
      dialog: { showOpenDialog },
      fromWebContents: (sender) => ({ window: sender }),
      appInfo: () => INFO,
    }).register();
    const invoke = (options: unknown) =>
      handlers.get('platform:pickDirectory')?.({ sender: 'wc' }, options);
    const invokeInfo = () =>
      handlers.get('platform:appInfo')?.({ sender: 'wc' }, undefined);
    return { invoke, invokeInfo, showOpenDialog };
  };

  it('открывает диалог папки у окна отправителя и возвращает путь', async () => {
    const { invoke, showOpenDialog } = setup({
      canceled: false,
      filePaths: ['/lib'],
    });
    await expect(invoke({ title: 'Курс' })).resolves.toBe('/lib');
    expect(showOpenDialog).toHaveBeenCalledWith(
      { window: 'wc' },
      { title: 'Курс', properties: ['openDirectory', 'createDirectory'] },
    );
  });

  it('сведения о сборке отдаёт main, окно своих не подставляет', async () => {
    const { invokeInfo } = setup({ canceled: true, filePaths: [] });
    await expect(invokeInfo()).resolves.toEqual(INFO);
  });

  it('отмена диалога — null; нестроковый title отбрасывается', async () => {
    const { invoke, showOpenDialog } = setup({ canceled: true, filePaths: [] });
    await expect(invoke({ title: 42 })).resolves.toBeNull();
    expect(showOpenDialog).toHaveBeenCalledWith(
      { window: 'wc' },
      { properties: ['openDirectory', 'createDirectory'] },
    );
    await expect(invoke(null)).resolves.toBeNull();
  });
});

describe('lifecycle shell', () => {
  it('на before-quit сначала останавливает хост, затем выходит', async () => {
    const registered: {
      handler?: (event: { preventDefault(): void }) => void;
    } = {};
    const quit = vi.fn();
    let finishStop: () => void = () => undefined;
    const stop = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishStop = resolve;
        }),
    );
    const stopExt = vi.fn(async () => undefined);
    createLifecycleShell({
      app: {
        on: (_event, listener) => {
          registered.handler = listener;
        },
        quit,
      },
      supervisors: [{ stop }, { stop: stopExt }],
    }).register();

    const first = { preventDefault: vi.fn() };
    registered.handler?.(first);
    expect(first.preventDefault).toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
    finishStop();
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));

    const second = { preventDefault: vi.fn() }; // повторный quit проходит
    registered.handler?.(second);
    expect(second.preventDefault).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(stopExt).toHaveBeenCalledTimes(1);
  });

  it('хосты останавливаются по очереди: сначала движок, затем расширения', async () => {
    const registered: {
      handler?: (event: { preventDefault(): void }) => void;
    } = {};
    const order: string[] = [];
    const quit = vi.fn();
    createLifecycleShell({
      app: {
        on: (_event, listener) => {
          registered.handler = listener;
        },
        quit,
      },
      supervisors: [
        { stop: async () => void order.push('engine') },
        { stop: async () => void order.push('ext') },
      ],
    }).register();
    registered.handler?.({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['engine', 'ext']);
  });
});

describe('window shell', () => {
  const setup = (
    options: {
      hidden?: boolean;
      additionalArguments?: string[];
      devServerUrl?: string;
    } = {},
  ) => {
    const created: { options: WindowOptions; window: BrowserWindowLike }[] = [];
    const listeners = new Map<string, () => void>();
    const openHandlers: ((d: { url: string }) => { action: 'deny' })[] = [];
    const openExternal = vi.fn(async () => undefined);
    const loaded: string[] = [];
    class FakeWindow implements BrowserWindowLike {
      webContents = {
        setWindowOpenHandler: (handler: (typeof openHandlers)[number]) => {
          openHandlers.push(handler);
        },
        openDevTools: () => undefined,
      };
      declare isMinimized: () => boolean;
      declare restore: () => void;
      declare focus: () => void;
      declare loadURL: (url: string) => Promise<void>;
      declare loadFile: (file: string) => Promise<void>;
      constructor(windowOptions: WindowOptions) {
        created.push({ options: windowOptions, window: this });
        this.isMinimized = () => false;
        this.restore = () => undefined;
        this.focus = () => undefined;
        this.loadURL = async (url) => {
          loaded.push(url);
        };
        this.loadFile = async (file) => {
          loaded.push(file);
        };
      }
      static getAllWindows = () => created.map((item) => item.window);
    }
    const quit = vi.fn();
    createWindowShell({
      app: {
        whenReady: () => Promise.resolve(),
        on: (event, listener) => {
          listeners.set(event, listener);
        },
        quit,
      },
      BrowserWindow: FakeWindow,
      shell: { openExternal },
      logger: silentLogger,
      preloadPath: '/preload/index.cjs',
      indexHtml: '/dist/index.html',
      hidden: options.hidden ?? false,
      additionalArguments: options.additionalArguments ?? [],
      platform: 'linux',
      ...(options.devServerUrl ? { devServerUrl: options.devServerUrl } : {}),
    }).register();
    return {
      created,
      listeners,
      openHandlers,
      openExternal,
      quit,
      loaded,
    };
  };

  it('окно изолировано: sandbox, contextIsolation, без nodeIntegration', async () => {
    const { created, loaded } = setup();
    await vi.waitFor(() => expect(loaded).toEqual(['/dist/index.html']));
    expect(created[0]?.options.webPreferences).toEqual({
      preload: '/preload/index.cjs',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [],
    });
    expect(created[0]?.options.show).toBe(true);
  });

  it('скрытое окно передаёт renderer дополнительные аргументы', async () => {
    const { created } = setup({
      hidden: true,
      additionalArguments: ['--dolphy-smoke'],
    });
    await vi.waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]?.options.show).toBe(false);
    expect(created[0]?.options.webPreferences.additionalArguments).toEqual([
      '--dolphy-smoke',
    ]);
  });

  it('новые окна отклоняются, https открывается снаружи', async () => {
    const { openHandlers, openExternal } = setup();
    await vi.waitFor(() => expect(openHandlers).toHaveLength(1));
    expect(openHandlers[0]?.({ url: 'https://example.org/' })).toEqual({
      action: 'deny',
    });
    expect(openExternal).toHaveBeenCalledWith('https://example.org/');
    openHandlers[0]?.({ url: 'file:///etc/passwd' });
    openHandlers[0]?.({ url: 'http://example.org/' });
    expect(openExternal).toHaveBeenCalledTimes(1);
  });

  it('в dev грузит адрес Vite; закрытие всех окон завершает приложение вне macOS', async () => {
    const { loaded, listeners, quit } = setup({
      devServerUrl: 'http://localhost:5173',
    });
    await vi.waitFor(() => expect(loaded).toEqual(['http://localhost:5173']));
    listeners.get('window-all-closed')?.();
    expect(quit).toHaveBeenCalled();
  });
});

describe('web-contents guard shell', () => {
  interface FakeContents {
    listeners: Map<string, (event: never) => void>;
    openHandler: (() => { action: 'deny' }) | null;
    url: string;
    on: (event: string, listener: (event: never) => void) => void;
    setWindowOpenHandler: (handler: () => { action: 'deny' }) => void;
    getURL: () => string;
  }
  const createContents = (url: string): FakeContents => {
    const contents: FakeContents = {
      listeners: new Map(),
      openHandler: null,
      url,
      on: (event, listener) => void contents.listeners.set(event, listener),
      setWindowOpenHandler: (handler) => {
        contents.openHandler = handler;
      },
      getURL: () => contents.url,
    };
    return contents;
  };
  const setup = () => {
    let created: ((event: unknown, contents: FakeContents) => void) | null =
      null;
    const session = {
      requestHandler: null as
        | ((
            c: unknown,
            p: string,
            callback: (granted: boolean) => void,
          ) => void)
        | null,
      checkHandler: null as (() => boolean) | null,
    };
    createWebContentsGuardShell({
      app: {
        whenReady: () => Promise.resolve(),
        on: (_event, listener) => {
          created = listener as never;
        },
      },
      session: {
        defaultSession: {
          setPermissionRequestHandler: (handler) => {
            session.requestHandler = handler;
          },
          setPermissionCheckHandler: (handler) => {
            session.checkHandler = handler;
          },
        },
      },
    }).register();
    const guard = (url = 'file:///app/index.html') => {
      const contents = createContents(url);
      created?.({}, contents);
      return contents;
    };
    const navigate = (
      contents: FakeContents,
      event: 'will-navigate' | 'will-frame-navigate',
      details: {
        url: string;
        isMainFrame?: boolean;
        frame?: { url: string } | null;
      },
    ): boolean => {
      const preventDefault = vi.fn();
      contents.listeners.get(event)?.({ preventDefault, ...details } as never);
      return preventDefault.mock.calls.length > 0;
    };
    return { session, guard, navigate };
  };

  it('любой запрос и проверка разрешения сеанса отклоняются', async () => {
    const { session } = setup();
    await vi.waitFor(() => expect(session.requestHandler).not.toBeNull());
    for (const permission of ['media', 'geolocation', 'notifications']) {
      const callback = vi.fn();
      session.requestHandler?.({}, permission, callback);
      expect(callback).toHaveBeenCalledWith(false);
    }
    expect(session.checkHandler?.()).toBe(false);
  });

  it('навигация главного кадра запрещена, кроме перезагрузки текущего адреса', () => {
    const { guard, navigate } = setup();
    const contents = guard();
    for (const event of ['will-navigate', 'will-frame-navigate'] as const) {
      expect(
        navigate(contents, event, {
          url: 'https://example.org/',
          isMainFrame: true,
        }),
      ).toBe(true);
      expect(
        navigate(contents, event, {
          url: 'file:///app/index.html',
          isMainFrame: true,
        }),
      ).toBe(false);
    }
  });

  it('подкадр: первая загрузка страницы рамки расширения разрешена, смена адреса загруженной рамки и чужие адреса — нет', () => {
    const { guard, navigate } = setup();
    const contents = guard();
    const frameNavigate = (url: string, loadedUrl: string) =>
      navigate(contents, 'will-frame-navigate', {
        url,
        isMainFrame: false,
        frame: { url: loadedUrl },
      });
    const page = 'dolphy-ext://acme.echo/__dolphy/frame.html';
    expect(frameNavigate(page, '')).toBe(false);
    // загруженная рамка не может сменить адрес, в том числе на свой же или на чужого расширения
    expect(frameNavigate(page, page)).toBe(true);
    expect(
      frameNavigate('dolphy-ext://acme.other/__dolphy/frame.html', page),
    ).toBe(true);
    expect(frameNavigate('https://example.org/', page)).toBe(true);
    // пустой подкадр не загружает что попало и не получает исключения перезагрузки главного кадра
    expect(frameNavigate('https://example.org/', '')).toBe(true);
    expect(frameNavigate('file:///app/index.html', '')).toBe(true);
  });

  it('открытие окон и <webview> запрещены у каждого webContents', () => {
    const { guard } = setup();
    for (const contents of [guard(), guard('dolphy-ext://acme.echo/')]) {
      expect(contents.openHandler?.()).toEqual({ action: 'deny' });
      const preventDefault = vi.fn();
      contents.listeners.get('will-attach-webview')?.({
        preventDefault,
      } as never);
      expect(preventDefault).toHaveBeenCalledTimes(1);
    }
  });
});
