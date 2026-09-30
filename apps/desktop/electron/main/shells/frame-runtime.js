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
 *   { dolphy: 1, type: 'props', view?, value?, disabled?, verdict? }   (answer)
 *   { dolphy: 1, type: 'theme', variables: { '--v-…': string }, dark: boolean }
 *   { dolphy: 1, type: 'dispose' }
 *
 * Рамка → приложение (`dolphyFrame: 1`):
 *   { dolphyFrame: 1, type: 'ready' }                  рантайм слушает сообщения
 *   { dolphyFrame: 1, type: 'answer-change', detail }  { value, complete }
 *   { dolphyFrame: 1, type: 'answer-submit' }          в том числе Ctrl/⌘+Enter
 *   { dolphyFrame: 1, type: 'size', height }           высота содержимого, px
 *   { dolphyFrame: 1, type: 'done' }                   markdown: блок выведен
 *   { dolphyFrame: 1, type: 'error', message }
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
  const ELEMENT_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;
  const VARIABLE_NAME = /^--v-[a-z0-9-]+$/;
  const PROP_NAMES = ['view', 'value', 'disabled', 'verdict'];

  const state = {
    started: false,
    element: null,
    props: {},
    variables: new Set(),
    height: -1,
    submitting: false,
    observer: null,
    controller: new AbortController(),
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

  const starters = { answer: startAnswer, markdown: startMarkdown };

  const handlers = {
    init: (message) => {
      if (state.started) return;
      state.started = true;
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
    theme: ({ variables, dark }) => {
      const root = doc.documentElement;
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

  doc.addEventListener(
    'keydown',
    (event) => {
      const isSubmit =
        (event.ctrlKey || event.metaKey) && event.key === 'Enter';
      if (!isSubmit || !state.element) return;
      event.preventDefault();
      submit();
    },
    true,
  );

  post({ type: 'ready' });
};
