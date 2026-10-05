import { EXTENSION_ID_PATTERN } from '@dolphy-app/engine-contract';
import { CHANNELS } from '../../../shared/bridge.ts';
import type { InstallLink } from '../../../shared/bridge.ts';
import type { MainLogger } from '../logger.ts';
import type { Shell } from './types.ts';

/** Схема ссылок приложения. */
export const DEEP_LINK_SCHEME = 'dolphy';

/** Ссылка длиннее этого не разбирается: `id` не больше 64 знаков, остальное фиксировано. */
const MAX_LINK_LENGTH = 256;
const MAX_ID_LENGTH = 64;
/** Сколько знаков отвергнутой ссылки попадает в журнал. */
const LOGGED_LINK_LENGTH = 120;

/** Схема и хост регистронезависимы (ОС и браузеры нормализуют их по-разному), путь и `id` — нет. */
const ORIGIN = `${DEEP_LINK_SCHEME}://extensions`;
const INSTALL_PATH = '/install/';

/**
 * Строгий разбор `dolphy://extensions/install/<id>`: схема `dolphy:`, хост
 * `extensions`, путь ровно `/install/<id>`, `id` по `EXTENSION_ID_PATTERN` до
 * 64 знаков, без логина, порта, параметров, фрагмента и завершающего `/`.
 * Всё остальное — `null`. Адрес не раскодируется: `%`-последовательности в `id`
 * недопустимы.
 */
export const parseInstallLink = (value: string): InstallLink | null => {
  if (value.length > MAX_LINK_LENGTH) return null;
  if (value.slice(0, ORIGIN.length).toLowerCase() !== ORIGIN) return null;
  const path = value.slice(ORIGIN.length);
  if (!path.startsWith(INSTALL_PATH)) return null;
  // логин, порт, параметры, фрагмент, вложенный путь и раскодирование отсекает сам шаблон id
  const id = path.slice(INSTALL_PATH.length);
  if (id.length > MAX_ID_LENGTH || !EXTENSION_ID_PATTERN.test(id)) return null;
  return { id };
};

/** Ссылки приложения среди аргументов командной строки (Windows и Linux: ОС передаёт ссылку аргументом). */
export const linksInArguments = (argv: readonly string[]): string[] =>
  argv.filter(
    (value) =>
      value.slice(0, DEEP_LINK_SCHEME.length + 1).toLowerCase() ===
      `${DEEP_LINK_SCHEME}:`,
  );

export interface DeepLinkSender {
  send(channel: string, payload: InstallLink): void;
  once(event: 'destroyed', listener: () => void): unknown;
  on(
    event: 'did-start-navigation',
    listener: (details: {
      isMainFrame: boolean;
      isSameDocument: boolean;
    }) => void,
  ): unknown;
  mainFrame: unknown;
}

export interface DeepLinkReadyEvent {
  sender: DeepLinkSender;
  senderFrame: unknown;
}

export interface DeepLinkShellDeps {
  app: {
    on(
      event: 'open-url',
      listener: (event: { preventDefault(): void }, url: string) => void,
    ): unknown;
    on(
      event: 'second-instance',
      listener: (event: unknown, argv: string[]) => void,
    ): unknown;
    setAsDefaultProtocolClient(scheme: string): boolean;
  };
  ipcMain: {
    on(channel: string, listener: (event: DeepLinkReadyEvent) => void): unknown;
  };
  /**
   * Регистрировать `dolphy:` как схему по умолчанию: только собранное
   * приложение (несобранное и смоук-сборка чужую запись ОС не перехватывают).
   */
  registerScheme: boolean;
  /** Аргументы запуска этого процесса (`process.argv`): холодный запуск по ссылке. */
  argv: readonly string[];
  logger: MainLogger;
  /** Выводит окно на передний план; без окна (до `ready`) ничего не делает. */
  reveal(): void;
}

/**
 * Ссылки `dolphy://extensions/install/<id>`. Источники: аргументы запуска
 * (Windows, Linux, холодный запуск), `second-instance` (второй запуск, пока
 * приложение работает) и `open-url` (macOS, в том числе до `ready`). Принятая
 * ссылка выводит окно вперёд и уходит окну по `deeplink:install`; пока окно не
 * подписалось (`deeplink:ready`), хранится последняя принятая: окно забирает
 * её при подписке, поэтому гонки холодного запуска нет. Ссылка только
 * открывает диалог установки в окне; ничего не ставит.
 */
export const createDeepLinkShell = (deps: DeepLinkShellDeps): Shell => ({
  register: () => {
    const { app, ipcMain, logger } = deps;
    let target: DeepLinkSender | null = null;
    let pending: InstallLink | null = null;

    const flush = () => {
      if (target === null || pending === null) return;
      const link = pending;
      pending = null;
      target.send(CHANNELS.deepLinkInstall, link);
    };

    const accept = (value: string) => {
      const link = parseInstallLink(value);
      if (link === null) {
        logger.warn(
          { link: value.slice(0, LOGGED_LINK_LENGTH) },
          'deep link ignored: not an install link',
        );
        return;
      }
      pending = link;
      deps.reveal();
      flush();
    };

    // open-url приходит и до ready: слушатель ставится синхронно при старте main
    app.on('open-url', (event, url) => {
      event.preventDefault();
      accept(url);
    });
    app.on('second-instance', (_event, argv) => {
      for (const value of linksInArguments(argv)) accept(value);
    });

    ipcMain.on(CHANNELS.deepLinkReady, (event) => {
      if (event.senderFrame !== event.sender.mainFrame) return; // только верхний фрейм
      const { sender } = event;
      target = sender;
      // перезагрузка окна: до новой подписки ссылки копятся
      sender.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
        if (isMainFrame && !isSameDocument && target === sender) target = null;
      });
      sender.once('destroyed', () => {
        if (target === sender) target = null;
      });
      flush();
    });

    if (
      deps.registerScheme &&
      !app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME)
    ) {
      logger.warn({}, 'dolphy: scheme was not registered');
    }

    for (const value of linksInArguments(deps.argv)) accept(value);
  },
});
