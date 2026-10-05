/**
 * Рантайм изолированной рамки расширения (`dolphy-ext://<id>/__dolphy/frame.js`).
 *
 * Рамка — `<iframe sandbox="allow-scripts">` без `allow-same-origin`: у неё
 * непрозрачный origin, поэтому она не видит ни DOM приложения, ни
 * `window.dolphy`, ни его хранилище; сеть закрыта CSP страницы рамки.
 * Единственный канал с приложением — `postMessage` (контракт ниже, родитель —
 * `src/shared/lib/frame-bridge.ts`). Файл — обычный JS без импортов: его
 * отдаёт протокол как есть (Vite `?raw`), поэтому константы здесь и в мосте
 * совпадают вручную.
 *
 * Приложение → рамка (`dolphy: 1`; принимаются только от `window.parent`):
 *   { dolphy: 1, type: 'init', mode: 'answer', rendererUrl, element, label }
 *   { dolphy: 1, type: 'init', mode: 'markdown', rendererUrl, language, source }
 *   { dolphy: 1, type: 'init', mode: 'panel', rendererUrl, panelId, props, context }
 *   { dolphy: 1, type: 'init', mode: 'widget', rendererUrl, widgetId, context }
 *   { dolphy: 1, type: 'props', view?, value?, disabled?, verdict? }   (answer)
 *   { dolphy: 1, type: 'panel-props', props }                         (panel)
 *   { dolphy: 1, type: 'context', context: { courseId } }             (panel, widget)
 *   { dolphy: 1, type: 'panel-result', callId, ok, value | error: { message } }
 *   { dolphy: 1, type: 'theme', variables: { '--v-…': string }, dark: boolean, lang }
 *   { dolphy: 1, type: 'dispose' }
 *
 * Рамка → приложение (`dolphyFrame: 1`):
 *   { dolphyFrame: 1, type: 'ready' }                  рантайм слушает сообщения
 *   { dolphyFrame: 1, type: 'answer-change', detail }  { value, complete }
 *   { dolphyFrame: 1, type: 'answer-submit' }          в том числе Ctrl/⌘+Enter
 *   { dolphyFrame: 1, type: 'size', height }           высота содержимого, px (answer, markdown, widget)
 *   { dolphyFrame: 1, type: 'overlay', height }        нужная высота рамки, px, пока открыт оверлей; null — закрыт (answer, markdown, widget)
 *   { dolphyFrame: 1, type: 'done' }                   markdown: блок выведен
 *   { dolphyFrame: 1, type: 'error', message }
 *   { dolphyFrame: 1, type: 'panel-call', callId, command, args }      panel, widget: вызов команды
 *   { dolphyFrame: 1, type: 'shortcut', key: 'mod+k' }                  panel, widget: только Ctrl/⌘+K
 *
 * `overlay` рамка шлёт по событию `dolphy-overlay` (`CustomEvent`, `bubbles`
 * и `composed`, `detail.height`: число ≥ 0 или `null`), которое расширение
 * бросает на любом своём элементе. Другие значения игнорируются, повтор того
 * же значения не шлётся; панель событие игнорирует.
 *
 * Режим `panel` занимает всю рамку (высоту задаёт приложение), `size` не
 * шлёт. Режим `widget` — карточка: высоту рамки приложение выбирает по `size`
 * и зажимает в диапазон манифеста, содержимое выше диапазона прокручивается
 * внутри рамки. Рамка не знает, чья она: расширение и допустимые команды
 * приложение привязывает при создании рамки и не читает из сообщений.
 * Родителю уходит только Ctrl/⌘+K, другие клавиши и события не пересылаются.
 * `context` — окружение, которое приложение сообщает панели и виджету
 * (`{ courseId: string | null }`); рантайм отдаёт его замороженным и
 * принимает только такую форму.
 *
 * Порядок: приложение ждёт `ready`, затем шлёт `init`, `theme`, `props`.
 * Модуль расширения грузится только с того же `dolphy-ext://<id>`, что и рамка.
 */
// eslint-disable-next-line no-unused-vars -- вызывается из собранного источника (extension-assets.ts)
const dolphyFrameRuntime = (win, loadModule) => {
  const doc = win.document;
  const LOAD_TIMEOUT_MS = 5000;
  const MAX_MESSAGE_CHARS = 10000;
  const MAX_VARIABLE_CHARS = 200;
  const MAX_COURSE_ID_CHARS = 200;
  const ELEMENT_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;
  const VARIABLE_NAME = /^--v-[a-z0-9-]+$/;
  const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,4}$/;
  const PROP_NAMES = ['view', 'value', 'disabled', 'verdict'];
  // клиент движка ждёт команду до 14 с: рамка не отвечает раньше приложения
  const CALL_TIMEOUT_MS = 15000;
  const MAX_CALL_ARGS_CHARS = 200000;

  const state = {
    started: false,
    element: null,
    props: {},
    variables: new Set(),
    height: -1,
    overlayEnabled: false,
    overlay: null,
    submitting: false,
    observer: null,
    controller: new AbortController(),
    interactive: false,
    context: Object.freeze({ courseId: null }),
    contextListeners: new Set(),
    panelProps: undefined,
    panelListeners: new Set(),
    calls: new Map(),
    callCount: 0,
  };

  const post = (message) => {
    win.parent.postMessage({ dolphyFrame: 1, ...message }, '*');
  };

  const fail = (error) => {
    const text = error instanceof Error ? error.message : String(error);
    post({ type: 'error', message: text.slice(0, MAX_MESSAGE_CHARS) });
  };

  const submit = () => {
    // Ctrl+Enter обрабатывают и рантайм, и сам элемент: отправляем один раз
    if (state.submitting) return;
    state.submitting = true;
    setTimeout(() => {
      state.submitting = false;
    }, 0);
    post({ type: 'answer-submit' });
  };

  const reportSize = () => {
    const height = Math.ceil(doc.body.getBoundingClientRect().height);
    if (height === state.height) return;
    state.height = height;
    post({ type: 'size', height });
  };

  const MAX_OVERLAY_HEIGHT = 100000;

  const reportOverlay = (event) => {
    if (!state.overlayEnabled) return;
    const height = event.detail?.height;
    let next;
    if (height === null) {
      next = null;
    } else if (typeof height === 'number' && Number.isFinite(height)) {
      if (height < 0) return;
      next = Math.min(Math.ceil(height), MAX_OVERLAY_HEIGHT);
    } else {
      return;
    }
    if (next === state.overlay) return;
    state.overlay = next;
    post({ type: 'overlay', height: next });
  };

  const observeSize = () => {
    state.observer = new win.ResizeObserver(reportSize);
    state.observer.observe(doc.body);
    reportSize();
  };

  const isSameExtension = (url) => {
    try {
      const target = new URL(url);
      return (
        target.protocol === win.location.protocol &&
        target.host === win.location.host
      );
    } catch {
      return false;
    }
  };

  const importModule = (url) => {
    if (typeof url !== 'string' || !isSameExtension(url)) {
      return Promise.reject(new Error('renderer is outside the extension'));
    }
    return loadModule(url);
  };

  const withTimeout = (promise, message) => {
    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), LOAD_TIMEOUT_MS);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  };

  const applyProps = () => {
    // свойства DOM, а не атрибуты: view и verdict — произвольные объекты
    if (state.element) Object.assign(state.element, state.props);
  };

  const startAnswer = async ({ rendererUrl, element, label }) => {
    if (typeof element !== 'string' || !ELEMENT_NAME.test(element)) {
      throw new Error('invalid element name');
    }
    await importModule(rendererUrl);
    await withTimeout(
      win.customElements.whenDefined(element),
      `extension did not define <${element}>`,
    );
    const created = doc.createElement(element);
    if (typeof label === 'string') created.setAttribute('aria-label', label);
    created.addEventListener('dolphy-answer-change', (event) => {
      const { value, complete } = event.detail ?? {};
      try {
        post({
          type: 'answer-change',
          detail: { value, complete: !!complete },
        });
      } catch (error) {
        fail(error);
      }
    });
    created.addEventListener('dolphy-answer-submit', submit);
    doc.body.append(created);
    state.element = created;
    applyProps();
    observeSize();
  };

  const startMarkdown = async ({ rendererUrl, language, source }) => {
    if (typeof language !== 'string' || typeof source !== 'string') {
      throw new Error('invalid markdown block');
    }
    const loaded = await importModule(rendererUrl);
    const module = loaded.default;
    if (typeof module?.render !== 'function') {
      throw new Error('module has no default export with render()');
    }
    const container = doc.createElement('div');
    doc.body.append(container);
    observeSize();
    await module.render(source, container, {
      language,
      signal: state.controller.signal,
    });
    post({ type: 'done' });
  };

  const closedError = () => new Error('frame is closed');

  // окружение приложения: только `{ courseId: string | null }`, всё остальное — «все курсы»
  const contextOf = (raw) => {
    const courseId = raw?.courseId;
    const valid =
      typeof courseId === 'string' &&
      courseId.length > 0 &&
      courseId.length <= MAX_COURSE_ID_CHARS;
    return Object.freeze({ courseId: valid ? courseId : null });
  };

  const callCommand = (commandId, args) => {
    if (state.controller.signal.aborted) return Promise.reject(closedError());
    if (typeof commandId !== 'string' || commandId === '') {
      return Promise.reject(new TypeError('command id must be a string'));
    }
    let text;
    try {
      text = args === undefined ? undefined : JSON.stringify(args);
    } catch {
      return Promise.reject(new TypeError('arguments are not JSON'));
    }
    if (text !== undefined && text.length > MAX_CALL_ARGS_CHARS) {
      return Promise.reject(new RangeError('arguments are too large'));
    }
    state.callCount += 1;
    const callId = `c${state.callCount}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        state.calls.delete(callId);
        reject(new Error('command timed out'));
      }, CALL_TIMEOUT_MS);
      state.calls.set(callId, { resolve, reject, timer });
      post({
        type: 'panel-call',
        callId,
        command: commandId,
        args: text === undefined ? undefined : JSON.parse(text),
      });
    });
  };

  // то, что у панели и виджета общее: вызов команд, окружение, сигнал закрытия
  const frameContext = () => ({
    get context() {
      return state.context;
    },
    signal: state.controller.signal,
    call: callCommand,
    onContextChange: (listener) => {
      state.contextListeners.add(listener);
      return () => state.contextListeners.delete(listener);
    },
  });

  const loadMountable = async (rendererUrl) => {
    const loaded = await importModule(rendererUrl);
    const module = loaded.default;
    if (typeof module?.mount !== 'function') {
      throw new Error('module has no default export with mount()');
    }
    return module;
  };

  const startPanel = async ({ rendererUrl, panelId, props, context }) => {
    if (typeof panelId !== 'string') throw new Error('invalid panel id');
    state.interactive = true;
    state.context = contextOf(context);
    state.panelProps = props;
    const module = await loadMountable(rendererUrl);
    // панель заполняет рамку: высоту задаёт приложение, `size` не шлём
    doc.documentElement.style.height = '100%';
    doc.body.style.height = '100%';
    const container = doc.createElement('div');
    container.style.height = '100%';
    doc.body.append(container);
    const base = frameContext();
    await module.mount(container, {
      get context() {
        return base.context;
      },
      signal: base.signal,
      call: base.call,
      onContextChange: base.onContextChange,
      panelId,
      props: state.panelProps,
      onProps: (listener) => {
        state.panelListeners.add(listener);
        return () => state.panelListeners.delete(listener);
      },
    });
  };

  const startWidget = async ({ rendererUrl, widgetId, context }) => {
    if (typeof widgetId !== 'string') throw new Error('invalid widget id');
    state.interactive = true;
    state.context = contextOf(context);
    const module = await loadMountable(rendererUrl);
    // виджет — карточка: приложение выбирает высоту рамки по `size`; выше диапазона — прокрутка внутри
    const container = doc.createElement('div');
    doc.body.append(container);
    observeSize();
    const base = frameContext();
    await module.mount(container, {
      get context() {
        return base.context;
      },
      signal: base.signal,
      call: base.call,
      onContextChange: base.onContextChange,
      widgetId,
    });
    // ResizeObserver молчит, пока браузер не рисует рамку (кросс-доменная рамка вне окна просмотра):
    // размер после монтирования читаем сами, раскладка принудительная и от рисования не зависит
    reportSize();
  };

  const starters = {
    answer: startAnswer,
    markdown: startMarkdown,
    panel: startPanel,
    widget: startWidget,
  };

  const handlers = {
    init: (message) => {
      if (state.started) return;
      state.started = true;
      state.overlayEnabled = ['answer', 'markdown', 'widget'].includes(
        message.mode,
      );
      const start = Object.hasOwn(starters, message.mode)
        ? starters[message.mode]
        : () => Promise.reject(new Error('unknown mode'));
      start(message).catch(fail);
    },
    props: (message) => {
      for (const name of PROP_NAMES) {
        if (name in message) state.props[name] = message[name];
      }
      applyProps();
    },
    'panel-props': ({ props }) => {
      state.panelProps = props;
      for (const listener of [...state.panelListeners]) {
        try {
          listener(props);
        } catch (error) {
          fail(error);
        }
      }
    },
    context: ({ context }) => {
      if (!state.interactive) return;
      const next = contextOf(context);
      if (next.courseId === state.context.courseId) return;
      state.context = next;
      for (const listener of [...state.contextListeners]) {
        try {
          listener(next);
        } catch (error) {
          fail(error);
        }
      }
    },
    'panel-result': ({ callId, ok, value, error }) => {
      // ответ на неизвестный (устаревший или уже истёкший) вызов игнорируется
      const entry = typeof callId === 'string' ? state.calls.get(callId) : null;
      if (!entry) return;
      state.calls.delete(callId);
      clearTimeout(entry.timer);
      if (ok === true) {
        entry.resolve(value);
        return;
      }
      const text = typeof error?.message === 'string' ? error.message : '';
      entry.reject(
        new Error(text.slice(0, MAX_MESSAGE_CHARS) || 'command failed'),
      );
    },
    theme: ({ variables, dark, lang }) => {
      const root = doc.documentElement;
      // язык интерфейса приложения: `<html lang>` нужен скринридеру и axe (`html-has-lang`)
      if (typeof lang === 'string' && LANGUAGE_TAG.test(lang)) {
        root.lang = lang;
      }
      const applied = new Set();
      for (const [name, value] of Object.entries(variables ?? {})) {
        const valid =
          VARIABLE_NAME.test(name) &&
          typeof value === 'string' &&
          value.length <= MAX_VARIABLE_CHARS;
        if (!valid) continue;
        root.style.setProperty(name, value);
        applied.add(name);
      }
      for (const name of state.variables) {
        if (!applied.has(name)) root.style.removeProperty(name);
      }
      state.variables = applied;
      root.style.setProperty('color-scheme', dark === true ? 'dark' : 'light');
    },
    dispose: () => {
      state.controller.abort();
      for (const entry of state.calls.values()) {
        clearTimeout(entry.timer);
        entry.reject(closedError());
      }
      state.calls.clear();
      state.panelListeners.clear();
      state.contextListeners.clear();
      state.observer?.disconnect();
      state.element = null;
      doc.body.replaceChildren();
    },
  };

  win.addEventListener('message', (event) => {
    if (event.source !== win.parent) return;
    const message = event.data;
    if (typeof message !== 'object' || message === null) return;
    if (message.dolphy !== 1 || typeof message.type !== 'string') return;
    if (Object.hasOwn(handlers, message.type)) handlers[message.type](message);
  });

  doc.addEventListener('dolphy-overlay', reportOverlay);

  doc.addEventListener(
    'keydown',
    (event) => {
      const mod = event.ctrlKey || event.metaKey;
      // панель пересылает приложению только Ctrl/⌘+K (палитра команд)
      const isPalette =
        mod &&
        !event.altKey &&
        !event.shiftKey &&
        (event.code === 'KeyK' || String(event.key).toLowerCase() === 'k');
      if (isPalette && state.interactive) {
        event.preventDefault();
        if (!event.repeat) post({ type: 'shortcut', key: 'mod+k' });
        return;
      }
      const isSubmit = mod && event.key === 'Enter';
      if (!isSubmit || !state.element) return;
      event.preventDefault();
      submit();
    },
    true,
  );

  post({ type: 'ready' });
};
