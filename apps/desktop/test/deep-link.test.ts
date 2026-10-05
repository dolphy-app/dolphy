import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  createDeepLinkShell,
  linksInArguments,
  parseInstallLink,
} from '../electron/main/shells/deep-link.ts';
import type {
  DeepLinkReadyEvent,
  DeepLinkSender,
} from '../electron/main/shells/deep-link.ts';

const ID64 = `a${'b'.repeat(63)}`;

describe('parseInstallLink', () => {
  it.each([
    ['dolphy://extensions/install/acme.sunrise', 'acme.sunrise'],
    ['dolphy://extensions/install/dolphy-x', 'dolphy-x'],
    ['dolphy://extensions/install/a', 'a'],
    [`dolphy://extensions/install/${ID64}`, ID64],
    // схема и хост регистронезависимы, id — нет
    ['DOLPHY://Extensions/install/acme.sunrise', 'acme.sunrise'],
  ])('принимает %s', (value, id) => {
    expect(parseInstallLink(value)).toEqual({ id });
  });

  it.each([
    // схема
    'https://extensions/install/acme.x',
    'dolphy:extensions/install/acme.x',
    'dolphy:///extensions/install/acme.x',
    'dolphyx://extensions/install/acme.x',
    'javascript:alert(1)',
    'file:///etc/passwd',
    // хост
    'dolphy://evil/install/acme.x',
    'dolphy://extensions.evil.test/install/acme.x',
    'dolphy://xextensions/install/acme.x',
    // логин и порт
    'dolphy://user@extensions/install/acme.x',
    'dolphy://user:pw@extensions/install/acme.x',
    'dolphy://extensions:8080/install/acme.x',
    'dolphy://extensions@evil.test/install/acme.x',
    // путь
    'dolphy://extensions',
    'dolphy://extensions/',
    'dolphy://extensions/install',
    'dolphy://extensions/install/',
    'dolphy://extensions/install/acme.x/',
    'dolphy://extensions/install/acme.x/extra',
    'dolphy://extensions//install/acme.x',
    'dolphy://extensions/install//acme.x',
    'dolphy://extensions/uninstall/acme.x',
    'dolphy://extensions/INSTALL/acme.x',
    'dolphy://extensions/install/../install/acme.x',
    // параметры и фрагмент, в том числе пустые
    'dolphy://extensions/install/acme.x?',
    'dolphy://extensions/install/acme.x?a=1',
    'dolphy://extensions/install/acme.x?version=1.0.0',
    'dolphy://extensions/install/acme.x#',
    'dolphy://extensions/install/acme.x#frag',
    // id
    'dolphy://extensions/install/Acme.x',
    'dolphy://extensions/install/acme..x',
    'dolphy://extensions/install/.acme',
    'dolphy://extensions/install/acme.',
    'dolphy://extensions/install/1acme',
    'dolphy://extensions/install/acme_x',
    'dolphy://extensions/install/acme%2Ex',
    'dolphy://extensions/install/acme%00',
    'dolphy://extensions/install/..',
    'dolphy://extensions/install/acme x',
    'dolphy://extensions/install/acme.x\n',
    'dolphy://extensions/install/acme.x\u0000',
    'dolphy://extensions/install/acmé',
    `dolphy://extensions/install/${ID64}b`,
    // мусор
    '',
    ' dolphy://extensions/install/acme.x',
    'dolphy://extensions/install/acme.x ',
    `dolphy://extensions/install/${'a'.repeat(100_000)}`,
  ])('отвергает %j', (value) => {
    expect(parseInstallLink(value)).toBeNull();
  });
});

describe('linksInArguments', () => {
  it('оставляет только аргументы со схемой dolphy:', () => {
    expect(
      linksInArguments([
        '/app/Dolphy',
        '--user-data-dir=/tmp/x',
        'dolphy://extensions/install/acme.x',
        'https://example.org',
        'DOLPHY:bad',
      ]),
    ).toEqual(['dolphy://extensions/install/acme.x', 'DOLPHY:bad']);
  });
});

describe('deep link shell', () => {
  const LINK = 'dolphy://extensions/install/acme.sunrise';
  const FRAME = {};

  const fakeSender = () => {
    const sent: { channel: string; payload: unknown }[] = [];
    const listeners = new Map<string, (...args: never[]) => void>();
    const sender: DeepLinkSender = {
      send: (channel, payload) => sent.push({ channel, payload }),
      once: (event, listener) => listeners.set(event, listener),
      on: (event, listener) => listeners.set(event, listener as never),
      mainFrame: FRAME,
    };
    return {
      sender,
      sent,
      navigate: (details: { isMainFrame: boolean; isSameDocument: boolean }) =>
        (listeners.get('did-start-navigation') as (d: typeof details) => void)(
          details,
        ),
      destroy: () => listeners.get('destroyed')?.(),
    };
  };

  const setup = (
    options: {
      argv?: string[];
      registerScheme?: boolean;
      registered?: boolean;
    } = {},
  ) => {
    const appListeners = new Map<string, (...args: never[]) => void>();
    let ready: (event: DeepLinkReadyEvent) => void = () => undefined;
    const reveal = vi.fn();
    const warn = vi.fn();
    const setAsDefaultProtocolClient = vi.fn(() => options.registered ?? true);
    createDeepLinkShell({
      app: {
        on: ((event: string, listener: (...args: never[]) => void) => {
          appListeners.set(event, listener);
        }) as never,
        setAsDefaultProtocolClient,
      },
      ipcMain: {
        on: (channel, listener) => {
          expect(channel).toBe('deeplink:ready');
          ready = listener;
        },
      },
      registerScheme: options.registerScheme ?? false,
      argv: options.argv ?? [],
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn,
        error: () => undefined,
      },
      reveal,
    }).register();
    const openUrl = (url: string) => {
      const preventDefault = vi.fn();
      (
        appListeners.get('open-url') as (
          event: { preventDefault(): void },
          url: string,
        ) => void
      )({ preventDefault }, url);
      return preventDefault;
    };
    const secondInstance = (argv: string[]) =>
      (
        appListeners.get('second-instance') as (
          event: unknown,
          argv: string[],
        ) => void
      )({}, argv);
    const subscribe = (sender = fakeSender()) => {
      ready({ sender: sender.sender, senderFrame: FRAME });
      return sender;
    };
    return {
      reveal,
      warn,
      setAsDefaultProtocolClient,
      openUrl,
      secondInstance,
      subscribe,
      ready,
    };
  };

  const install = (id: string) => ({
    channel: 'deeplink:install',
    payload: { id },
  });

  it('холодный запуск (Windows, Linux): ссылка из argv ждёт подписки окна', () => {
    const shell = setup({
      argv: ['/app/Dolphy', '--lang=ru', LINK],
    });
    expect(shell.reveal).toHaveBeenCalledTimes(1);
    const window = fakeSender();
    expect(window.sent).toEqual([]);
    shell.subscribe(window);
    expect(window.sent).toEqual([install('acme.sunrise')]);
    // отдана один раз
    shell.subscribe(window);
    expect(window.sent).toHaveLength(1);
  });

  it('второй запуск: ссылка из argv уходит подписанному окну сразу, окно выводится вперёд', () => {
    const shell = setup();
    const window = shell.subscribe();
    shell.secondInstance(['/app/Dolphy', '--lang=ru', LINK]);
    expect(window.sent).toEqual([install('acme.sunrise')]);
    expect(shell.reveal).toHaveBeenCalledTimes(1);
  });

  it('второй запуск без ссылки ничего не делает', () => {
    const shell = setup();
    const window = shell.subscribe();
    shell.secondInstance(['/app/Dolphy', '--user-data-dir=/tmp/x']);
    expect(window.sent).toEqual([]);
    expect(shell.reveal).not.toHaveBeenCalled();
    expect(shell.warn).not.toHaveBeenCalled();
  });

  it('macOS open-url: событие поглощается; ссылка до готовности окна ждёт подписки', () => {
    const shell = setup();
    const preventDefault = shell.openUrl(LINK);
    expect(preventDefault).toHaveBeenCalledOnce();
    const window = fakeSender();
    expect(window.sent).toEqual([]);
    shell.subscribe(window);
    expect(window.sent).toEqual([install('acme.sunrise')]);
    shell.openUrl('dolphy://extensions/install/acme.moon');
    expect(window.sent).toEqual([
      install('acme.sunrise'),
      install('acme.moon'),
    ]);
  });

  it('до подписки хранится последняя принятая ссылка', () => {
    const shell = setup({ argv: [LINK] });
    shell.openUrl('dolphy://extensions/install/acme.moon');
    const window = shell.subscribe();
    expect(window.sent).toEqual([install('acme.moon')]);
  });

  it('отвергнутая ссылка не выводит окно и не доходит до окна; в журнал — предупреждение', () => {
    const shell = setup();
    const window = shell.subscribe();
    shell.openUrl('dolphy://extensions/install/acme.x?evil=1');
    shell.secondInstance(['/app/Dolphy', 'dolphy://evil/install/acme.x']);
    expect(window.sent).toEqual([]);
    expect(shell.reveal).not.toHaveBeenCalled();
    expect(shell.warn).toHaveBeenCalledTimes(2);
  });

  it('в журнал попадает не больше начала отвергнутой ссылки', () => {
    const shell = setup();
    shell.openUrl(`dolphy://${'x'.repeat(10_000)}`);
    const [[fields]] = shell.warn.mock.calls as unknown as [[{ link: string }]];
    expect(fields.link.length).toBeLessThanOrEqual(120);
  });

  it('подписка из вложенного фрейма игнорируется', () => {
    const shell = setup({ argv: [LINK] });
    const window = fakeSender();
    shell.ready({ sender: window.sender, senderFrame: {} });
    expect(window.sent).toEqual([]);
  });

  it('перезагрузка окна: ссылки копятся до новой подписки; подкадр и переход внутри страницы не сбрасывают подписку', () => {
    const shell = setup();
    const window = shell.subscribe();
    window.navigate({ isMainFrame: false, isSameDocument: false });
    window.navigate({ isMainFrame: true, isSameDocument: true });
    shell.openUrl(LINK);
    expect(window.sent).toHaveLength(1);

    window.navigate({ isMainFrame: true, isSameDocument: false });
    shell.openUrl('dolphy://extensions/install/acme.moon');
    expect(window.sent).toHaveLength(1);
    shell.subscribe(window);
    expect(window.sent).toEqual([
      install('acme.sunrise'),
      install('acme.moon'),
    ]);
  });

  it('закрытое окно не получает ссылок: они ждут нового', () => {
    const shell = setup();
    const closed = shell.subscribe();
    closed.destroy();
    shell.openUrl(LINK);
    expect(closed.sent).toEqual([]);
    const reopened = shell.subscribe();
    expect(reopened.sent).toEqual([install('acme.sunrise')]);
  });

  describe('регистрация схемы', () => {
    it('собранное приложение регистрирует dolphy:', () => {
      const shell = setup({ registerScheme: true });
      expect(shell.setAsDefaultProtocolClient).toHaveBeenCalledWith('dolphy');
      expect(shell.warn).not.toHaveBeenCalled();
    });

    it('несобранное приложение схему не перехватывает', () => {
      const shell = setup({ registerScheme: false });
      expect(shell.setAsDefaultProtocolClient).not.toHaveBeenCalled();
    });

    it('отказ системы — предупреждение в журнал', () => {
      const shell = setup({ registerScheme: true, registered: false });
      expect(shell.warn).toHaveBeenCalledOnce();
    });
  });
});

describe('electron-builder.json', () => {
  const config = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../electron-builder.json', import.meta.url)),
      'utf8',
    ),
  ) as {
    protocols?: { schemes: string[] }[];
    linux?: { mimeTypes?: string[] };
  };

  it('установщики объявляют схему dolphy: (macOS, Windows) и x-scheme-handler (Linux)', () => {
    expect(config.protocols?.flatMap((entry) => entry.schemes)).toContain(
      'dolphy',
    );
    expect(config.linux?.mimeTypes).toContain('x-scheme-handler/dolphy');
  });
});
