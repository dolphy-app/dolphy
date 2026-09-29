import { describe, expect, it, vi } from 'vitest';
import { createEngineShell } from '../electron/main/shells/engine.ts';
import type { EngineConnectEvent } from '../electron/main/shells/engine.ts';
import { createLifecycleShell } from '../electron/main/shells/lifecycle.ts';
import { createPlatformShell } from '../electron/main/shells/platform.ts';
import type { PickDirectoryEvent } from '../electron/main/shells/platform.ts';
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

describe('platform shell', () => {
  const setup = (dialogResult: { canceled: boolean; filePaths: string[] }) => {
    let handler:
      | ((e: PickDirectoryEvent, options: unknown) => Promise<string | null>)
      | null = null;
    const showOpenDialog = vi.fn(async () => dialogResult);
    createPlatformShell({
      ipcMain: {
        handle: (channel, listener) => {
          expect(channel).toBe('platform:pickDirectory');
          handler = listener;
        },
      },
      dialog: { showOpenDialog },
      fromWebContents: (sender) => ({ window: sender }),
    }).register();
    const invoke = (options: unknown) => handler?.({ sender: 'wc' }, options);
    return { invoke, showOpenDialog };
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
    createLifecycleShell({
      app: {
        on: (_event, listener) => {
          registered.handler = listener;
        },
        quit,
      },
      supervisor: { stop },
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
  });
});

describe('window shell', () => {
  const setup = (options: { smoke?: boolean; devServerUrl?: string } = {}) => {
    const created: { options: WindowOptions; window: BrowserWindowLike }[] = [];
    const listeners = new Map<string, () => void>();
    const navigation: { handler: (e: { preventDefault(): void }) => void }[] =
      [];
    const openHandlers: ((d: { url: string }) => { action: 'deny' })[] = [];
    const openExternal = vi.fn(async () => undefined);
    const loaded: string[] = [];
    class FakeWindow implements BrowserWindowLike {
      webContents = {
        setWindowOpenHandler: (handler: (typeof openHandlers)[number]) => {
          openHandlers.push(handler);
        },
        on: (_event: 'will-navigate', handler: never) => {
          navigation.push({ handler });
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
      smoke: options.smoke ?? false,
      platform: 'linux',
      ...(options.devServerUrl ? { devServerUrl: options.devServerUrl } : {}),
    }).register();
    return {
      created,
      listeners,
      navigation,
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

  it('смоук: окно скрыто, preload узнаёт о режиме из аргумента', async () => {
    const { created } = setup({ smoke: true });
    await vi.waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]?.options.show).toBe(false);
    expect(created[0]?.options.webPreferences.additionalArguments).toEqual([
      '--lms-smoke',
    ]);
  });

  it('навигация запрещена, новые окна отклоняются, https открывается снаружи', async () => {
    const { navigation, openHandlers, openExternal } = setup();
    await vi.waitFor(() => expect(navigation).toHaveLength(1));
    const preventDefault = vi.fn();
    navigation[0]?.handler({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
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
