import type { AnswerChangeDetail, JsonValue } from '@dolphy-app/extension-api';
import { createDomThemeSource } from './frame-theme.ts';
import type { ThemeSource } from './frame-theme.ts';

/**
 * Сторона приложения моста с изолированной рамкой расширения
 * (`<iframe sandbox="allow-scripts">`). Контракт сообщений описан в
 * `electron/main/shells/frame-runtime.js`: приложение шлёт `{ dolphy: 1, … }`,
 * рамка отвечает `{ dolphyFrame: 1, … }`. Рамка имеет непрозрачный origin, поэтому
 * `postMessage` адресуется `'*'`, а подлинность отправителя проверяется по
 * `event.source === iframe.contentWindow`.
 */

const SCHEME = 'dolphy-ext:';
const FRAME_PAGE = '/__dolphy/frame.html';

export const MAX_FRAME_HEIGHT = 4000;
export const MAX_ERROR_CHARS = 10_000;
/** Предел JSON-аргументов `panel-call` (как у `engine.extensions.invokeCommand`). */
export const MAX_PANEL_ARGS_CHARS = 200_000;
const MAX_CALL_ID_CHARS = 64;
const MAX_COMMAND_ID_CHARS = 128;
/** Вызовов команд из одной рамки: не чаще в секунду и не более одновременно. */
export const PANEL_CALLS_PER_SECOND = 20;
export const PANEL_CALLS_IN_FLIGHT = 4;
const RATE_WINDOW_MS = 1000;
const READY_TIMEOUT_MS = 10_000;

export type FrameInit =
  | { mode: 'answer'; rendererUrl: string; element: string; label: string }
  | { mode: 'markdown'; rendererUrl: string; language: string; source: string }
  | { mode: 'panel'; rendererUrl: string; panelId: string; props?: JsonValue };

export interface FrameProps {
  view: unknown;
  value: unknown;
  disabled: boolean;
  verdict: unknown;
}

export type FrameEvent =
  | { type: 'ready' }
  | { type: 'answer-change'; detail: AnswerChangeDetail }
  | { type: 'answer-submit' }
  | { type: 'size'; height: number }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | {
      type: 'panel-call';
      callId: string;
      command: string;
      args: JsonValue | undefined;
    }
  | { type: 'shortcut'; key: 'mod+k' };

type Fields = Record<string, unknown>;

const isBoundedString = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

/**
 * Аргументы вызова команды: JSON не длиннее `MAX_PANEL_ARGS_CHARS`. Возвращает
 * значение, прошедшее через JSON (без функций и прочего не-JSON), либо `null`.
 */
const parseCallArgs = (
  args: unknown,
): { value: JsonValue | undefined } | null => {
  if (args === undefined) return { value: undefined };
  let text: string | undefined;
  try {
    text = JSON.stringify(args);
  } catch {
    return null;
  }
  if (text === undefined || text.length > MAX_PANEL_ARGS_CHARS) return null;
  return { value: JSON.parse(text) as JsonValue };
};

/** Проверяет форму сообщения рамки; всё постороннее — `null`. */
export const parseFrameMessage = (raw: unknown): FrameEvent | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as Fields;
  if (data.dolphyFrame !== 1) return null;
  switch (data.type) {
    case 'ready':
    case 'answer-submit':
    case 'done':
      return { type: data.type };
    case 'answer-change': {
      const detail = data.detail as Fields | null | undefined;
      if (typeof detail !== 'object' || detail === null) return null;
      if (typeof detail.complete !== 'boolean') return null;
      return {
        type: 'answer-change',
        detail: { value: detail.value, complete: detail.complete },
      };
    }
    case 'size': {
      const { height } = data;
      if (typeof height !== 'number' || !Number.isFinite(height)) return null;
      return {
        type: 'size',
        height: Math.round(Math.min(Math.max(height, 0), MAX_FRAME_HEIGHT)),
      };
    }
    case 'error':
      if (typeof data.message !== 'string') return null;
      return {
        type: 'error',
        message: data.message.slice(0, MAX_ERROR_CHARS),
      };
    case 'panel-call': {
      // идентификатор расширения в сообщении не читается: рамка привязана приложением
      if (!isBoundedString(data.callId, MAX_CALL_ID_CHARS)) return null;
      if (!isBoundedString(data.command, MAX_COMMAND_ID_CHARS)) return null;
      const args = parseCallArgs(data.args);
      if (args === null) return null;
      return {
        type: 'panel-call',
        callId: data.callId,
        command: data.command,
        args: args.value,
      };
    }
    case 'shortcut':
      return data.key === 'mod+k' ? { type: 'shortcut', key: 'mod+k' } : null;
    default:
      return null;
  }
};

/** Адрес страницы рамки расширения по адресу его модуля (`dolphy-ext://<id>/…`). */
export const frameUrlOf = (rendererUrl: string): string => {
  const url = new URL(rendererUrl);
  if (url.protocol !== SCHEME) {
    throw new Error(`renderer url is not an extension url: ${rendererUrl}`);
  }
  return `${SCHEME}//${url.host}${FRAME_PAGE}`;
};

/** Значения для `postMessage`: реактивные прокси не клонируются. */
const toPlain = (value: unknown): unknown =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));

export interface FrameHandlers {
  onChange?(detail: AnswerChangeDetail): void;
  onSubmit?(): void;
  onSize?(height: number): void;
  onDone?(): void;
  onError?(message: string): void;
  /** Рамка панели переслала Ctrl/⌘+K (единственное сочетание, которое она передаёт). */
  onShortcut?(): void;
}

/**
 * Привязка рамки панели к расширению. Создаётся приложением вместе с рамкой:
 * идентификатор расширения и допустимые команды берутся отсюда, а не из
 * сообщений рамки.
 */
export interface PanelBinding {
  extensionId: string;
  /** Команды, объявленные расширением (в том числе `palette: false`). */
  commands: ReadonlySet<string>;
  /** Исполняет команду и эффекты результата; отдаёт рамке JSON-ответ обработчика. */
  invoke(
    extensionId: string,
    commandId: string,
    args: JsonValue | undefined,
  ): Promise<JsonValue | undefined>;
}

export interface FrameHostOptions {
  /** `<iframe>`, уже вставленный в документ (у него есть `contentWindow`). */
  frame: HTMLIFrameElement;
  init: FrameInit;
  props?: Partial<FrameProps>;
  handlers: FrameHandlers;
  /** Только для `init.mode === 'panel'`: без неё вызовы команд и сочетания игнорируются. */
  panel?: PanelBinding;
  /** Откуда приходят сообщения; по умолчанию окно приложения. */
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  theme?: ThemeSource;
  /** Сколько ждать `ready`, прежде чем сообщить об ошибке (страница рамки не загрузилась). */
  readyTimeoutMs?: number;
}

export interface FrameHost {
  update(props: Partial<FrameProps>): void;
  /** Новые свойства открытой панели (`openPanel(id, props)`); до `ready` копятся. */
  updatePanelProps(props: JsonValue | undefined): void;
  dispose(): void;
}

/** Сообщение об ошибке вызова для рамки: текст, обрезанный до `MAX_ERROR_CHARS`. */
const describeCallError = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(
    0,
    MAX_ERROR_CHARS,
  );

type PanelCall = Extract<FrameEvent, { type: 'panel-call' }>;

/**
 * Вызовы команд из рамки панели: расширение и допустимые команды задаёт
 * приложение; не более `PANEL_CALLS_PER_SECOND` вызовов в секунду и
 * `PANEL_CALLS_IN_FLIGHT` одновременно; ответ после `dispose` не отправляется.
 */
const createPanelCalls = (
  binding: PanelBinding,
  reply: (message: Record<string, unknown>) => void,
  isDisposed: () => boolean,
) => {
  const inFlight = new Set<string>();
  const startedAt: number[] = [];
  const fail = (callId: string, message: string) =>
    reply({
      type: 'panel-result',
      callId,
      ok: false,
      error: { message },
    });

  return (call: PanelCall): void => {
    // повтор идентификатора вызова, который ещё выполняется, — устаревший: игнорируем
    if (inFlight.has(call.callId)) return;
    if (!binding.commands.has(call.command)) {
      fail(call.callId, `unknown command: ${call.command}`);
      return;
    }
    const now = Date.now();
    while (
      startedAt.length > 0 &&
      now - (startedAt[0] ?? 0) >= RATE_WINDOW_MS
    ) {
      startedAt.shift();
    }
    if (startedAt.length >= PANEL_CALLS_PER_SECOND) {
      fail(call.callId, 'too many calls per second');
      return;
    }
    if (inFlight.size >= PANEL_CALLS_IN_FLIGHT) {
      fail(call.callId, 'too many calls in flight');
      return;
    }
    startedAt.push(now);
    inFlight.add(call.callId);
    binding
      .invoke(binding.extensionId, call.command, call.args)
      .then(
        (value) => {
          if (isDisposed()) return;
          reply({
            type: 'panel-result',
            callId: call.callId,
            ok: true,
            value,
          });
        },
        (error: unknown) => {
          if (!isDisposed()) fail(call.callId, describeCallError(error));
        },
      )
      .finally(() => inFlight.delete(call.callId));
  };
};

/**
 * Связывает `iframe` с приложением: ждёт `ready`, отправляет `init`, тему и
 * свойства, принимает только проверенные сообщения только от этой рамки.
 */
export const createFrameHost = (options: FrameHostOptions): FrameHost => {
  const { frame, init, handlers } = options;
  const target = options.target ?? window;
  const theme = options.theme ?? createDomThemeSource(frame.ownerDocument);
  const props: Partial<FrameProps> = { ...options.props };
  let panelProps: JsonValue | undefined =
    init.mode === 'panel' ? init.props : undefined;
  let ready = false;
  let disposed = false;
  const readyTimer = setTimeout(() => {
    if (!ready && !disposed) handlers.onError?.('frame did not start');
  }, options.readyTimeoutMs ?? READY_TIMEOUT_MS);

  const post = (message: Record<string, unknown>) => {
    frame.contentWindow?.postMessage({ dolphy: 1, ...message }, '*');
  };
  const postProps = (changed: Partial<FrameProps>) => {
    const plain: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(changed)) {
      plain[key] = toPlain(value);
    }
    post({ type: 'props', ...plain });
  };
  const postTheme = () => {
    const { variables, dark } = theme.read();
    post({ type: 'theme', variables, dark });
  };
  // вызовы команд и сочетание принимает только рамка панели, привязанная приложением
  const handleCall =
    init.mode === 'panel' && options.panel
      ? createPanelCalls(options.panel, post, () => disposed)
      : null;

  const onReady = () => {
    ready = true;
    clearTimeout(readyTimer);
    if (init.mode === 'panel') {
      post({ ...init, type: 'init', props: toPlain(panelProps) });
      postTheme();
      return;
    }
    post({ ...init, type: 'init' });
    postTheme();
    postProps(props);
  };

  const onMessage = (event: Event) => {
    const { source, data } = event as MessageEvent;
    if (frame.contentWindow === null || source !== frame.contentWindow) return;
    const message = parseFrameMessage(data);
    if (message === null) return;
    switch (message.type) {
      case 'ready':
        onReady();
        break;
      case 'answer-change':
        handlers.onChange?.(message.detail);
        break;
      case 'answer-submit':
        handlers.onSubmit?.();
        break;
      case 'size':
        handlers.onSize?.(message.height);
        break;
      case 'done':
        handlers.onDone?.();
        break;
      case 'error':
        handlers.onError?.(message.message);
        break;
      case 'panel-call':
        if (ready) handleCall?.(message);
        break;
      case 'shortcut':
        if (ready && handleCall !== null) handlers.onShortcut?.();
        break;
    }
  };

  target.addEventListener('message', onMessage);
  const unsubscribe = theme.subscribe(() => {
    if (ready) postTheme();
  });

  return {
    update: (changed) => {
      Object.assign(props, changed);
      if (ready) postProps(changed);
    },
    updatePanelProps: (next) => {
      panelProps = next;
      if (ready) post({ type: 'panel-props', props: toPlain(next) });
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearTimeout(readyTimer);
      if (ready) post({ type: 'dispose' });
      target.removeEventListener('message', onMessage);
      unsubscribe();
    },
  };
};
