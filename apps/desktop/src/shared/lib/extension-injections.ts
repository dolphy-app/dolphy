import { h, render, watch } from 'vue';
import type { App, Component } from 'vue';
import type {
  InjectionHandle,
  InjectionPosition,
} from '@dolphy-app/extension-api';
import InjectionHost from '@/shared/ui/InjectionHost.vue';
import type { ClientInjection, ExtensionClients } from './extension-clients.ts';

/** Атрибут контейнера-хоста, в который рисуется компонент вставки. */
export const INJECTION_HOST_ATTRIBUTE = 'data-ext-injection';

const HOST_SELECTOR = `[${INJECTION_HOST_ATTRIBUTE}]`;

export interface InjectionMounterDeps {
  /** Основное приложение: компонент вставки рисуется с его `provide`, компонентами, i18n и темой. */
  app: App;
  /** Поддерево, в котором ищутся цели и за которым следит наблюдатель. */
  root?: Element;
  /** Реестр вставок и способ пометить расширение `failed`. */
  clients: Pick<ExtensionClients, 'injections' | 'fail'>;
  /** Откладывает проход до следующего кадра; в тестах подменяется. */
  schedule?: (run: () => void) => void;
}

export interface InjectionMounter {
  /** Снимает все вставки и останавливает слежение. */
  dispose(): void;
}

interface InjectionState {
  injection: ClientInjection;
  /** Хост вставки по цели. */
  hosts: Map<Element, HTMLElement>;
}

/** Что оболочка вставки рисует: компонент расширения и его положение. */
export interface ShellContent {
  extensionId: string;
  /** Подпись хоста: id вставки или `mountAt`. */
  injectionId: string;
  component: Component;
  componentProps?: Readonly<Record<string, unknown>>;
  handle: InjectionHandle;
}

/**
 * Общая часть вставок и `mountAt`: создаёт контейнер-хост (`display: contents`),
 * ставит его через `placeHost` и рисует в него оболочку R4 с компонентом.
 * `render()` создаёт отдельное дерево без `provide` и глобальных компонентов
 * приложения. Публичного способа передать контекст приложения в `render` у Vue
 * нет, поэтому берётся `app._context`: единственная опора на приватное поле.
 */
export const mountShell = (
  app: App,
  ownerDocument: Document,
  content: ShellContent,
  placeHost: (host: HTMLElement) => void,
): HTMLElement => {
  const host = ownerDocument.createElement('div');
  host.setAttribute(
    INJECTION_HOST_ATTRIBUTE,
    `${content.extensionId}/${content.injectionId}`,
  );
  host.setAttribute('data-testid', 'extension-injection');
  host.style.display = 'contents';
  placeHost(host);
  const vnode = h(InjectionHost, content);
  vnode.appContext = app._context;
  render(vnode, host);
  return host;
};

/** Снимает хост, созданный `mountShell`. */
export const unmountShell = (host: HTMLElement) => {
  render(null, host);
  host.remove();
};

/** Хост на месте, если его не сдвинул и не унёс перерисовкой чужой код. */
const isPlaced = (
  target: Element,
  host: HTMLElement,
  position: InjectionPosition,
): boolean =>
  position === 'before' || position === 'after'
    ? host.parentNode === target.parentNode
    : host.parentNode === target;

const place = (
  target: Element,
  host: HTMLElement,
  position: InjectionPosition,
) => {
  switch (position) {
    case 'before':
      target.before(host);
      return;
    case 'after':
      target.after(host);
      return;
    case 'prepend':
      target.prepend(host);
      return;
    case 'append':
      target.append(host);
  }
};

/**
 * Рисует компоненты вставок расширений (`addInjection`) в DOM окна. По
 * селектору `target` находит элементы под `root`, ставит рядом с ними или
 * внутрь контейнер-хост (`display: contents`) и рисует в него компонент через
 * `render` с контекстом приложения. Наблюдатель за `root` повторяет поиск
 * (один проход на кадр): новые цели получают компонент, исчезнувшие и
 * потерявшие хост теряют его. В уже обслуженную цель вставка не повторяется.
 * Селектор, который `querySelectorAll` не принимает: причина в журнал,
 * расширение `failed`, остальные не затронуты. Элементы внутри хостов целями
 * не бывают: иначе селектор вроде `div` вставлял бы компоненты друг в друга.
 */
export const createInjectionMounter = (
  deps: InjectionMounterDeps,
): InjectionMounter => {
  const { app, clients } = deps;
  const root = deps.root ?? document.body;
  const schedule =
    deps.schedule ?? ((run: () => void) => void requestAnimationFrame(run));
  const states = new Map<string, InjectionState>();
  let pending = false;
  let disposed = false;

  // содержимое хостов (компонент перерисовывается сам) целей не меняет
  const relevant = ({ target }: MutationRecord): boolean =>
    ((target instanceof Element ? target : target.parentElement)?.closest(
      HOST_SELECTOR,
    ) ?? null) === null;

  const unmountAll = (state: InjectionState) => {
    for (const host of state.hosts.values()) unmountShell(host);
    state.hosts.clear();
  };

  const mount = ({ injection }: InjectionState, target: Element) =>
    mountShell(
      app,
      root.ownerDocument,
      {
        extensionId: injection.extensionId,
        injectionId: injection.id,
        component: injection.component,
        handle: { target, position: injection.position },
      },
      (host) => place(target, host, injection.position),
    );

  const targetsOf = (injection: ClientInjection): Element[] | null => {
    try {
      return [...root.querySelectorAll(injection.target)].filter(
        (element) => element.closest(HOST_SELECTOR) === null,
      );
    } catch (error) {
      clients.fail(
        injection.extensionId,
        new Error(
          `injection '${injection.id}': invalid target '${injection.target}' (${
            error instanceof Error ? error.message : String(error)
          })`,
        ),
      );
      return null;
    }
  };

  const sync = (observed: MutationObserver) => {
    pending = false;
    if (disposed) return;
    const wanted = new Map(
      clients.injections.value.map((injection) => [injection.key, injection]),
    );
    for (const [key, state] of states) {
      if (wanted.has(key)) continue;
      unmountAll(state);
      states.delete(key);
    }
    for (const [key, injection] of wanted) {
      // неверный селектор: расширение помечено `failed`, его вставки снимет следующий проход
      const targets = targetsOf(injection);
      if (targets === null) continue;
      let state = states.get(key);
      if (state === undefined) {
        state = { injection, hosts: new Map() };
        states.set(key, state);
      }
      const found = new Set(targets);
      for (const [target, host] of state.hosts) {
        if (
          found.has(target) &&
          host.isConnected &&
          isPlaced(target, host, injection.position)
        ) {
          continue;
        }
        unmountShell(host);
        state.hosts.delete(target);
      }
      for (const target of targets) {
        if (!state.hosts.has(target)) {
          state.hosts.set(target, mount(state, target));
        }
      }
    }
    // проход читал DOM целиком, а свои вставки и снятия повода для нового прохода не дают
    observed.takeRecords();
  };

  const request = (observed: MutationObserver) => {
    if (pending || disposed) return;
    pending = true;
    schedule(() => sync(observed));
  };

  const observer = new MutationObserver((records, self) => {
    if (records.some(relevant)) request(self);
  });

  observer.observe(root, { childList: true, subtree: true });
  const stop = watch(
    () => clients.injections.value,
    () => request(observer),
    {
      flush: 'sync',
    },
  );
  request(observer);

  return {
    dispose: () => {
      disposed = true;
      stop();
      observer.disconnect();
      for (const state of states.values()) unmountAll(state);
      states.clear();
    },
  };
};
