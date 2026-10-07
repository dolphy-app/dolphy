import { computed, inject, shallowRef, watch } from 'vue';
import type { ComputedRef, InjectionKey, Ref, ShallowRef } from 'vue';
import type {
  ContributionsDto,
  ExtensionClientDto,
  ExtensionEngine,
} from '@dolphy-app/engine-contract';
import type { ClientEntry, EntryResult } from '@dolphy-app/extension-api';
import { createClientContext } from './extension-client-registrations.ts';
import type { ExtensionApps } from './extension-context.ts';
import type {
  ClientAnswerView,
  ClientCommand,
  ClientInjection,
  ClientMarkdownRenderer,
  ClientPanel,
  ClientRegistration,
  ClientTheme,
} from './extension-client-registrations.ts';
import { declaredCommands } from './declared-commands.ts';
import { moduleUrlOf } from './extension-url.ts';

export type {
  ClientAnswerView,
  ClientCommand,
  ClientInjection,
  ClientMarkdownRenderer,
  ClientPanel,
  ClientTheme,
} from './extension-client-registrations.ts';

export type LoadExtensionModule = (url: string) => Promise<unknown>;

export const importExtensionModule: LoadExtensionModule = (url) =>
  import(/* @vite-ignore */ url);

/** Состояние клиентской части расширения в окне. */
export interface ClientState {
  /** `loading` — первая загрузка идёт; `failed` — не загрузилась (причина в `error`). */
  status: 'loading' | 'loaded' | 'failed';
  error: string | null;
}

export interface ExtensionClientsDeps {
  /** Вклады движка: клиентские части включённых расширений и серверные команды; читается реактивно. */
  contributions: () => Readonly<Pick<ContributionsDto, 'clients' | 'commands'>>;
  /** Загрузчик модулей; в окне — `import()`. */
  loadModule?: LoadExtensionModule;
  /** `AppApi` расширений: `client(c).app`. */
  apps: ExtensionApps;
  /** Клиент движка окна: `client(c).engine`. */
  engine: ExtensionEngine;
}

export interface ExtensionClients {
  /** Вклады загруженных клиентских частей в порядке id расширения, затем регистрации. */
  readonly panels: ComputedRef<readonly ClientPanel[]>;
  readonly injections: ComputedRef<readonly ClientInjection[]>;
  readonly answerViews: ComputedRef<readonly ClientAnswerView[]>;
  readonly markdownRenderers: ComputedRef<readonly ClientMarkdownRenderer[]>;
  readonly themes: ComputedRef<readonly ClientTheme[]>;
  readonly commands: ComputedRef<readonly ClientCommand[]>;
  /** Состояние по id расширений, у которых есть клиентская часть. */
  readonly states: Readonly<Ref<ReadonlyMap<string, ClientState>>>;
  /** Загружает клиентскую часть расширения заново (повтор после сбоя). */
  reload(extensionId: string): void;
  /** Помечает расширение `failed` и снимает его вклады: сбой, найденный уже после загрузки. */
  fail(extensionId: string, error: unknown): void;
  /** Снимает все вклады и останавливает слежение. */
  dispose(): void;
}

export const EXTENSION_CLIENTS_KEY: InjectionKey<ExtensionClients> =
  Symbol('extension-clients');

export const useExtensionClients = (): ExtensionClients => {
  const clients = inject(EXTENSION_CLIENTS_KEY);
  if (!clients) throw new Error('extension clients are not provided');
  return clients;
};

/** Загруженная клиентская часть: её вклады и способ её выгрузить. */
interface LoadedClient {
  source: ExtensionClientDto;
  items: ShallowRef<readonly ClientRegistration[]>;
  unload(): Promise<void>;
}

interface Tracked {
  source: ExtensionClientDto;
  /** Номер попытки: повтор после сбоя берёт модуль по новому адресу. */
  attempt: number;
  /** Растёт при каждом запуске загрузки; результат прежней устарел. */
  token: number;
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const sameSource = (left: ExtensionClientDto, right: ExtensionClientDto) =>
  left.url === right.url && left.revision === right.revision;

const entryOf = (module: unknown): ClientEntry => {
  const entry =
    typeof module === 'object' && module !== null && 'client' in module
      ? module.client
      : undefined;
  if (typeof entry !== 'function')
    throw new Error("module has no 'client' export");
  // автор экспортирует `client` по контракту `ClientEntry`; форму вызова проверяют регистрации
  return entry as ClientEntry;
};

const cleanupOf = (
  result: EntryResult,
): (() => void | Promise<void>) | null => {
  if (typeof result === 'function') return result;
  if (typeof result === 'object' && result !== null) {
    return () => result.dispose();
  }
  return null;
};

const byExtension = <T extends { extensionId: string }>(
  items: readonly T[],
): T[] =>
  items.toSorted(
    (left, right) =>
      Number(left.extensionId > right.extensionId) -
      Number(left.extensionId < right.extensionId),
  );

/**
 * Реестр клиентских частей расширений в окне. По `contributions().clients`
 * импортирует `client.mjs` каждого расширения, вызывает его экспорт `client` с
 * контекстом регистрации и держит реактивные наборы вкладов. Расширение
 * изменилось (`revision`) — модуль грузится заново, а вклады прежнего
 * экземпляра заменяются разом, когда новый зарегистрировался; расширение
 * удалено или отключено — вклады снимаются и вызывается его очистка. Ошибка
 * импорта, `client(c)` или проверки регистрации: причина в журнал, расширение
 * в состоянии `failed` без вкладов (частично зарегистрированное откатывается),
 * остальные расширения не затронуты.
 */
export const createExtensionClients = (
  deps: ExtensionClientsDeps,
): ExtensionClients => {
  const loadModule = deps.loadModule ?? importExtensionModule;
  const loaded = shallowRef<ReadonlyMap<string, LoadedClient>>(new Map());
  const states = shallowRef<ReadonlyMap<string, ClientState>>(new Map());
  const tracked = new Map<string, Tracked>();
  let instances = 0;
  let tokens = 0;

  const setState = (extensionId: string, state: ClientState | null) => {
    const next = new Map(states.value);
    if (state === null) next.delete(extensionId);
    else next.set(extensionId, state);
    states.value = next;
  };

  const unload = async (entry: LoadedClient) => {
    try {
      await entry.unload();
    } catch (error) {
      console.error(
        { error, extensionId: entry.source.extensionId },
        'extension client cleanup failed',
      );
    }
  };

  /** Убирает загруженную часть расширения из реестра и выгружает её. */
  const drop = (extensionId: string) => {
    const entry = loaded.value.get(extensionId);
    if (entry === undefined) return;
    const next = new Map(loaded.value);
    next.delete(extensionId);
    loaded.value = next;
    void unload(entry);
  };

  const createEntry = (source: ExtensionClientDto) => {
    const { extensionId } = source;
    const items = shallowRef<readonly ClientRegistration[]>([]);
    let closed = false;
    let cleanup: (() => void | Promise<void>) | null = null;
    instances += 1;
    const instance = instances;
    let keys = 0;
    const context = createClientContext({
      extensionId,
      app: deps.apps.of(extensionId),
      engine: deps.engine,
      nextKey: () => {
        keys += 1;
        return `${extensionId}:${instance}:${keys}`;
      },
      current: () => items.value,
      serverCommandIds: () =>
        declaredCommands(deps.contributions(), extensionId),
      add: (registration) => {
        if (closed) throw new Error('the client part is unloaded');
        items.value = [...items.value, registration];
        return {
          dispose: () => {
            items.value = items.value.filter((item) => item !== registration);
          },
        };
      },
    });
    const entry: LoadedClient = {
      source,
      items,
      unload: async () => {
        closed = true;
        items.value = [];
        await cleanup?.();
      },
    };
    return {
      entry,
      context,
      setCleanup: (next: (() => void | Promise<void>) | null) => {
        cleanup = next;
      },
    };
  };

  const fail = (extensionId: string, error: unknown) => {
    console.error({ error, extensionId }, 'extension client failed');
    drop(extensionId);
    setState(extensionId, { status: 'failed', error: errorText(error) });
  };

  const load = async (extensionId: string) => {
    const track = tracked.get(extensionId);
    if (track === undefined) return;
    tokens += 1;
    track.token = tokens;
    const { token, source, attempt } = track;
    const stale = () => tracked.get(extensionId)?.token !== token;
    if (!loaded.value.has(extensionId)) {
      setState(extensionId, { status: 'loading', error: null });
    }
    let module: unknown;
    try {
      module = await loadModule(moduleUrlOf(source, attempt));
    } catch (error) {
      if (!stale()) fail(extensionId, error);
      return;
    }
    if (stale()) return;
    const created = createEntry(source);
    try {
      const entry = entryOf(module);
      created.setCleanup(cleanupOf(await entry(created.context)));
    } catch (error) {
      await unload(created.entry);
      if (!stale()) fail(extensionId, error);
      return;
    }
    if (stale()) {
      await unload(created.entry);
      return;
    }
    const previous = loaded.value.get(extensionId);
    loaded.value = new Map(loaded.value).set(extensionId, created.entry);
    setState(extensionId, { status: 'loaded', error: null });
    if (previous !== undefined) await unload(previous);
  };

  const reconcile = (clients: readonly ExtensionClientDto[]) => {
    const wanted = new Map(
      clients.map((client) => [client.extensionId, client]),
    );
    for (const extensionId of [...tracked.keys()]) {
      if (wanted.has(extensionId)) continue;
      tracked.delete(extensionId);
      drop(extensionId);
      setState(extensionId, null);
    }
    for (const [extensionId, source] of wanted) {
      const current = tracked.get(extensionId);
      if (current !== undefined && sameSource(current.source, source)) continue;
      tracked.set(extensionId, { source, attempt: 0, token: 0 });
      void load(extensionId);
    }
  };

  const stop = watch(() => deps.contributions().clients, reconcile, {
    immediate: true,
    flush: 'sync',
  });

  const registrationsOf = <K extends ClientRegistration['kind']>(kind: K) =>
    computed(() =>
      byExtension(
        [...loaded.value.values()].flatMap((entry) =>
          entry.items.value.filter(
            (item): item is Extract<ClientRegistration, { kind: K }> =>
              item.kind === kind,
          ),
        ),
      ),
    );

  return {
    panels: registrationsOf('panel'),
    injections: registrationsOf('injection'),
    answerViews: registrationsOf('answerView'),
    markdownRenderers: registrationsOf('markdownRenderer'),
    themes: registrationsOf('theme'),
    commands: registrationsOf('command'),
    states,
    fail,
    reload: (extensionId) => {
      const track = tracked.get(extensionId);
      if (track === undefined) return;
      track.attempt += 1;
      void load(extensionId);
    },
    dispose: () => {
      stop();
      tracked.clear();
      const entries = [...loaded.value.values()];
      loaded.value = new Map();
      states.value = new Map();
      for (const entry of entries) void unload(entry);
    },
  };
};
