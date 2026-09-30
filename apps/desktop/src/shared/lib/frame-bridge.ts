import type { AnswerChangeDetail } from '@lms/extension-api';
import { createDomThemeSource } from './frame-theme.ts';
import type { ThemeSource } from './frame-theme.ts';

/**
 * Сторона приложения моста с изолированной рамкой расширения
 * (`<iframe sandbox="allow-scripts">`). Контракт сообщений описан в
 * `electron/main/shells/frame-runtime.js`: приложение шлёт `{ lms: 1, … }`,
 * рамка отвечает `{ lmsFrame: 1, … }`. Рамка имеет непрозрачный origin, поэтому
 * `postMessage` адресуется `'*'`, а подлинность отправителя проверяется по
 * `event.source === iframe.contentWindow`.
 */

const SCHEME = 'lms-ext:';
const FRAME_PAGE = '/__lms/frame.html';

export const MAX_FRAME_HEIGHT = 4000;
export const MAX_ERROR_CHARS = 10_000;
const READY_TIMEOUT_MS = 10_000;

export type FrameInit =
  | { mode: 'answer'; rendererUrl: string; element: string; label: string }
  | { mode: 'markdown'; rendererUrl: string; language: string; source: string };

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
  | { type: 'error'; message: string };

type Fields = Record<string, unknown>;

/** Проверяет форму сообщения рамки; всё постороннее — `null`. */
export const parseFrameMessage = (raw: unknown): FrameEvent | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as Fields;
  if (data.lmsFrame !== 1) return null;
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
    default:
      return null;
  }
};

/** Адрес страницы рамки расширения по адресу его модуля (`lms-ext://<id>/…`). */
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
}

export interface FrameHostOptions {
  /** `<iframe>`, уже вставленный в документ (у него есть `contentWindow`). */
  frame: HTMLIFrameElement;
  init: FrameInit;
  props?: Partial<FrameProps>;
  handlers: FrameHandlers;
  /** Откуда приходят сообщения; по умолчанию окно приложения. */
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  theme?: ThemeSource;
  /** Сколько ждать `ready`, прежде чем сообщить об ошибке (страница рамки не загрузилась). */
  readyTimeoutMs?: number;
}

export interface FrameHost {
  update(props: Partial<FrameProps>): void;
  dispose(): void;
}

/**
 * Связывает `iframe` с приложением: ждёт `ready`, отправляет `init`, тему и
 * свойства, принимает только проверенные сообщения только от этой рамки.
 */
export const createFrameHost = (options: FrameHostOptions): FrameHost => {
  const { frame, init, handlers } = options;
  const target = options.target ?? window;
  const theme = options.theme ?? createDomThemeSource(frame.ownerDocument);
  const props: Partial<FrameProps> = { ...options.props };
  let ready = false;
  let disposed = false;
  const readyTimer = setTimeout(() => {
    if (!ready && !disposed) handlers.onError?.('frame did not start');
  }, options.readyTimeoutMs ?? READY_TIMEOUT_MS);

  const post = (message: Record<string, unknown>) => {
    frame.contentWindow?.postMessage({ lms: 1, ...message }, '*');
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

  const onMessage = (event: Event) => {
    const { source, data } = event as MessageEvent;
    if (frame.contentWindow === null || source !== frame.contentWindow) return;
    const message = parseFrameMessage(data);
    if (message === null) return;
    switch (message.type) {
      case 'ready':
        ready = true;
        clearTimeout(readyTimer);
        post({ ...init, type: 'init' });
        postTheme();
        postProps(props);
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
