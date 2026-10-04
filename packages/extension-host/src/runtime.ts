import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import type { MessageEndpoint } from '@dolphy-app/engine-contract';
import {
  EXTENSION_COMMAND_LIMITS,
  InvalidCommandResultError,
  PermissionError,
  normalizeCommandResult,
} from '@dolphy-app/extension-api';
import type {
  CommandHandler,
  Disposable,
  ExerciseTypeHandler,
  ExtensionContext,
  ExtensionLogger,
  ExtensionModule,
  GradePolicyHandler,
  LearningEventName,
  LibraryReader,
} from '@dolphy-app/extension-api';
import { createCatalog } from './catalog.ts';
import type { ResolvedExtension } from './discover.ts';
import { ENGINE_REQUEST_MS, EngineRequestError } from './engine-link.ts';
import type { EngineLink } from './engine-link.ts';
import { createDiscoveryHolder, discoveryOf } from './holder.ts';
import { createAllTrustedPolicy } from './policy.ts';
import {
  extMessageSchema,
  gradeResultSchema,
  gradeValueSchema,
} from './protocol.ts';
import type {
  ExtMessage,
  ExtRequest,
  ExtResponse,
  HealthReport,
  HostFailure,
  HostResponse,
  SettingChangedNotice,
} from './protocol.ts';
import type { RestrictedRunner, RunnerFactory } from './restricted-runner.ts';
import { createExtensionStorage, createSettingsState } from './state.ts';
import type { SettingsState } from './state.ts';

export interface ExtensionRuntimeOptions {
  /** Начальный набор; позже его заменяет `replace`. */
  extensions: readonly ResolvedExtension[];
  library: LibraryReader;
  logger: ExtensionLogger;
  /** Шов для тестов: модуль расширения с этим id берётся отсюда вместо `import()`. */
  modules?: Readonly<Record<string, ExtensionModule>>;
  /**
   * Фабрика ограниченных раннеров. Без неё запросы с `isolated: true` для
   * расширений не из поставки отклоняются: неверная настройка не должна молча
   * исполнять код без ограничений.
   */
  runners?: RunnerFactory;
  /** false — не маршрутизировать по `isolated`: сам процесс и есть ограничение (дочерний процесс раннера). */
  enforceIsolation?: boolean;
  /**
   * Запас сверх срока вызова (`timeoutMs` у `grade`, 10 с у команд, 5 с у остальных), сколько
   * `replace` ждёт вызов, идущий в момент замены, прежде чем вытеснить
   * расширение. Совпадает с запасом движка до дедлайна; по умолчанию 2000.
   */
  drainGraceMs?: number;
  /**
   * Срок `activate()` (загрузка модуля, настройки, сам вызов): не завершился —
   * сбой `activation-timeout`, он запоминается до замены сборки. По умолчанию
   * `ACTIVATION_TIMEOUT_MS`; тот же срок у ограниченного процесса (`readyTimeoutMs`).
   */
  activationTimeoutMs?: number;
}

export interface ExtensionRuntime {
  handle(request: ExtRequest): Promise<ExtResponse>;
  /**
   * Заменяет набор расширений. Каталог меняется сразу и целиком: вызовы, пришедшие
   * после, идут в новую сборку. Расширение, которого нет в новом наборе или
   * которое изменилось (версия, файлы, вклады), вытесняется: его активация
   * получает `deactivate()`, ограниченный процесс закрывается — после того как
   * закончатся вызовы, шедшие в момент замены (не дольше их срока и запаса).
   * Незатронутые расширения не перезагружаются. Промис завершается, когда
   * вытеснение закончено; на подтверждение движку оно не влияет.
   */
  replace(extensions: readonly ResolvedExtension[]): Promise<void>;
  attach(endpoint: MessageEndpoint): void;
  dispose(): Promise<void>;
}

type FailureCause = Extract<ExtResponse, { ok: false }>['error']['cause'];

class RuntimeFailure extends Error {
  readonly failure: FailureCause;
  constructor(failure: FailureCause, message: string) {
    super(message);
    this.failure = failure;
  }
}

const MAX_MESSAGE = 500;
const messageOf = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(
    0,
    MAX_MESSAGE,
  );

/** Срок вызова, кроме `grade`, у клиента хоста (`projectTimeoutMs`). */
const DEFAULT_CALL_MS = 5000;

/** Срок `activate()` расширения в процессе хоста; совпадает с `readyTimeoutMs` ограниченного процесса. */
export const ACTIVATION_TIMEOUT_MS = 10_000;

/** Срок обработчика события обучения (R6). */
export const EVENT_HANDLER_MS = 2000;

/** Срок обработчика команды расширения (R3); раннер ограниченного процесса и клиент движка ждут дольше. */
export const COMMAND_HANDLER_MS = EXTENSION_COMMAND_LIMITS.handlerMs;

const ignore = (): void => {};

/** Регистрация после срока активации: ничего не делает, освобождать нечего. */
const lateRegistration: Disposable = { dispose: ignore };

/** Обработчик не уложился в срок: `invoke` превращает её в `handler-timeout`. */
class HandlerTimeout extends Error {}

/** Ждёт `work`, но не дольше `ms`; опоздавший результат и отказ отбрасываются. */
const within = async <T>(work: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new HandlerTimeout(`handler timed out after ${ms} ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
};

/** Ждёт `promise` (отказ не важен), но не дольше `ms`. */
const settledWithin = async (
  promise: Promise<unknown>,
  ms: number,
): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, Math.max(ms, 0));
  });
  try {
    await Promise.race([promise.then(ignore, ignore), expired]);
  } finally {
    clearTimeout(timer);
  }
};

interface Activation {
  module: ExtensionModule;
  handlers: Map<string, ExerciseTypeHandler>;
  policies: Map<string, GradePolicyHandler>;
  events: Map<LearningEventName, (payload: unknown) => void | Promise<void>>;
  commands: Map<string, CommandHandler>;
  settings: SettingsState;
  disposables: Disposable[];
  /** Срок активации вышел: регистрации, которые код делает позже, ничего не регистрируют. */
  abandoned: boolean;
}

/** Запрос хоста к движку, ожидающий ответа. */
interface EnginePending {
  endpoint: MessageEndpoint;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/** Активация расширения: появляется сразу, готова — когда `ready`; запоминается вместе с отказом. */
interface Slot {
  /** `null`, пока модуль грузится. */
  activation: Activation | null;
  ready: Promise<Activation>;
}

/** Вызов, идущий прямо сейчас; `deadlineAt` — до какого момента его стоит ждать при замене. */
interface Flight {
  done: Promise<void>;
  deadlineAt: number;
}

export const createExtensionRuntime = (
  options: ExtensionRuntimeOptions,
): ExtensionRuntime => {
  const { logger } = options;
  const drainGraceMs = options.drainGraceMs ?? 2000;
  const activationTimeoutMs =
    options.activationTimeoutMs ?? ACTIVATION_TIMEOUT_MS;
  // каталог читает снимок, `replace` подменяет его целиком
  const discovery = createDiscoveryHolder(discoveryOf(options.extensions));
  const catalog = createCatalog(discovery, createAllTrustedPolicy());
  // текущая сборка расширения; совпадение по тождеству объекта = «ещё актуальна»
  let known = new Map(options.extensions.map((item) => [item.id, item]));
  const slots = new Map<string, Slot>();
  const runners = new Map<string, RestrictedRunner>();
  const flights = new Map<string, Set<Flight>>();
  const retiring = new Set<Promise<void>>();
  // загрузчик ESM не вытесняет модули: каждая загрузка получает свой `?v=`
  const loads = new Map<string, number>();
  const enforceIsolation = options.enforceIsolation ?? true;
  let current: MessageEndpoint | null = null;
  // запросы к движку: собственные идентификаторы `h<N>`, таймер перезапуска не взводят
  const engineRequests = new Map<string, EnginePending>();
  let nextEngineId = 0;

  const failEngineRequests = (
    endpoint: MessageEndpoint,
    failure: HostFailure,
  ): void => {
    for (const [id, pending] of [...engineRequests]) {
      if (pending.endpoint !== endpoint) continue;
      clearTimeout(pending.timer);
      engineRequests.delete(id);
      pending.reject(new EngineRequestError(failure));
    }
  };

  const engine: EngineLink = {
    request: (method, params) =>
      new Promise((resolve, reject) => {
        const endpoint = current;
        if (endpoint === null) {
          reject(
            new EngineRequestError({
              code: 'UNAVAILABLE',
              message: 'engine is not connected',
            }),
          );
          return;
        }
        const id = `h${nextEngineId++}`;
        const timer = setTimeout(() => {
          engineRequests.delete(id);
          reject(
            new EngineRequestError({
              code: 'TIMEOUT',
              message: `engine did not answer '${method}' in ${ENGINE_REQUEST_MS} ms`,
            }),
          );
        }, ENGINE_REQUEST_MS);
        engineRequests.set(id, { endpoint, resolve, reject, timer });
        endpoint.post({ id, method, params });
      }),
  };

  const settleEngineRequest = (response: HostResponse): void => {
    const pending = engineRequests.get(response.id);
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    engineRequests.delete(response.id);
    if (response.ok) pending.resolve(response.result);
    else pending.reject(new EngineRequestError(response.error));
  };

  const loadModule = async (
    extension: ResolvedExtension,
  ): Promise<ExtensionModule> => {
    const injected = options.modules?.[extension.id];
    if (injected === undefined && extension.mainPath === null) {
      throw new Error(`extension '${extension.id}' has no main`);
    }
    let module = injected;
    if (module === undefined) {
      const load = (loads.get(extension.id) ?? 0) + 1;
      loads.set(extension.id, load);
      const url = `${pathToFileURL(extension.mainPath ?? '').href}?v=${load}`;
      module = ((await import(url)) as { default?: ExtensionModule }).default;
    }
    if (
      module === undefined ||
      module === null ||
      typeof module.activate !== 'function'
    ) {
      throw new Error(`extension '${extension.id}' has no activate()`);
    }
    return module;
  };

  /** Код мог забыть вклад, который манифест объявил: обращение к нему потом упадёт, а здесь причина видна сразу. */
  const warnUnregistered = (
    extension: ResolvedExtension,
    activation: Activation,
  ): void => {
    const missing = {
      exerciseTypes: extension.exerciseTypes
        .map((type) => type.id)
        .filter((id) => !activation.handlers.has(id)),
      gradePolicies: extension.gradePolicies
        .map((policy) => policy.id)
        .filter((id) => !activation.policies.has(id)),
      events: extension.events
        .map(({ event }) => event)
        .filter((event) => !activation.events.has(event)),
      commands: extension.commands
        .map(({ id }) => id)
        .filter((id) => !activation.commands.has(id)),
    };
    for (const [kind, ids] of Object.entries(missing)) {
      if (ids.length === 0) continue;
      logger.warn(
        { extensionId: extension.id, kind, ids },
        'declared in the manifest but not registered by the extension code',
      );
    }
  };

  const activate = async (
    extension: ResolvedExtension,
    created: (activation: Activation) => void,
  ): Promise<Activation> => {
    const module = await loadModule(extension);
    const declared = new Set(extension.exerciseTypes.map((type) => type.id));
    const declaredPolicies = new Set(
      extension.gradePolicies.map((policy) => policy.id),
    );
    const declaredEvents = new Set(extension.events.map(({ event }) => event));
    const declaredCommands = new Set(extension.commands.map(({ id }) => id));
    const settings = createSettingsState(
      extension.id,
      extension.settings,
      logger,
    );
    const activation: Activation = {
      module,
      handlers: new Map(),
      policies: new Map(),
      events: new Map(),
      commands: new Map(),
      settings,
      disposables: [{ dispose: settings.dispose }],
      abandoned: false,
    };
    created(activation);
    // изменения, пришедшие во время загрузки, `settings` применяет поверх неё
    await settings.load(() =>
      engine.request('settings.all', { extensionId: extension.id }),
    );
    const context: ExtensionContext = {
      extensionId: extension.id,
      logger: options.logger,
      library: options.library,
      storage: createExtensionStorage(engine, extension.id),
      settings: settings.api,
      events: {
        on(name, handler) {
          if (!extension.permissions.includes('learning.events')) {
            throw new PermissionError('learning.events');
          }
          if (!declaredEvents.has(name)) {
            throw new Error(
              `event '${name}' is not declared in the manifest of '${extension.id}'`,
            );
          }
          if (activation.abandoned) return lateRegistration;
          if (activation.events.has(name)) {
            throw new Error(`event '${name}' is already subscribed`);
          }
          const stored = handler as (payload: unknown) => void | Promise<void>;
          activation.events.set(name, stored);
          const disposable: Disposable = {
            dispose: () => {
              if (activation.events.get(name) === stored) {
                activation.events.delete(name);
              }
            },
          };
          activation.disposables.push(disposable);
          return disposable;
        },
      },
      commands: {
        register(id, handler) {
          if (!declaredCommands.has(id)) {
            throw new Error(
              `command '${id}' is not declared in the manifest of '${extension.id}'`,
            );
          }
          if (activation.abandoned) return lateRegistration;
          if (activation.commands.has(id)) {
            throw new Error(`command '${id}' is already registered`);
          }
          activation.commands.set(id, handler);
          const disposable: Disposable = {
            dispose: () => {
              if (activation.commands.get(id) === handler) {
                activation.commands.delete(id);
              }
            },
          };
          activation.disposables.push(disposable);
          return disposable;
        },
      },
      registerExerciseType(type, handler) {
        if (!declared.has(type)) {
          throw new Error(
            `exercise type '${type}' is not declared in the manifest of '${extension.id}'`,
          );
        }
        if (activation.abandoned) return lateRegistration;
        if (activation.handlers.has(type)) {
          throw new Error(`exercise type '${type}' is already registered`);
        }
        activation.handlers.set(type, handler);
        const disposable: Disposable = {
          dispose: () => void activation.handlers.delete(type),
        };
        activation.disposables.push(disposable);
        return disposable;
      },
      registerGradePolicy(id, handler) {
        if (!declaredPolicies.has(id)) {
          throw new Error(
            `grade policy '${id}' is not declared in the manifest of '${extension.id}'`,
          );
        }
        if (activation.abandoned) return lateRegistration;
        if (activation.policies.has(id)) {
          throw new Error(`grade policy '${id}' is already registered`);
        }
        activation.policies.set(id, handler);
        const disposable: Disposable = {
          dispose: () => void activation.policies.delete(id),
        };
        activation.disposables.push(disposable);
        return disposable;
      },
    };
    await module.activate(context);
    if (!activation.abandoned) warnUnregistered(extension, activation);
    return activation;
  };

  /** Сборка, заменённая после начала вызова, не оживает: её активация осталась бы без владельца. */
  const assertCurrent = (extension: ResolvedExtension): void => {
    if (known.get(extension.id) !== extension) {
      throw new RuntimeFailure(
        'activation-failed',
        `extension '${extension.id}' was replaced`,
      );
    }
  };

  /** Сообщение о здоровье движку: учёт не должен ломать вызов, поэтому отказ канала молча теряется. */
  const reportHealth = (report: HealthReport): void => {
    engine.request('health.report', report).catch(ignore);
  };

  const openSlot = (extension: ResolvedExtension): Slot => {
    let created: Activation | null = null;
    const started = performance.now();
    let abandoned = false;
    const work = activate(extension, (activation) => {
      created = activation;
      activation.abandoned = abandoned;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        abandoned = true;
        if (created !== null) created.abandoned = true;
        logger.warn(
          { extensionId: extension.id },
          'extension activation timed out',
        );
        reject(
          new RuntimeFailure(
            'activation-timeout',
            `activate() did not finish in ${activationTimeoutMs} ms`,
          ),
        );
      }, activationTimeoutMs);
    });
    // опоздавший отказ активации не должен всплыть необработанным
    work.catch(ignore);
    const ready = Promise.race([work, expired]).finally(() => {
      clearTimeout(timer);
    });
    // успешная активация записывает длительность (в ограниченном процессе — его рантайм через раннер)
    void ready.then(
      () =>
        reportHealth({
          extensionId: extension.id,
          kind: 'activated',
          durationMs: Math.round(performance.now() - started),
        }),
      ignore,
    );
    return {
      get activation() {
        return created;
      },
      ready,
    };
  };

  const activationOf = async (
    extension: ResolvedExtension,
  ): Promise<Activation> => {
    assertCurrent(extension);
    let slot = slots.get(extension.id);
    if (slot === undefined) {
      slot = openSlot(extension);
      slots.set(extension.id, slot);
    }
    try {
      return await slot.ready;
    } catch (error) {
      if (error instanceof RuntimeFailure) throw error;
      throw new RuntimeFailure('activation-failed', messageOf(error));
    }
  };

  const handlerFor = async (
    extension: ResolvedExtension | undefined,
    type: string,
  ): Promise<ExerciseTypeHandler> => {
    if (extension === undefined) {
      throw new RuntimeFailure(
        'unknown-type',
        `unknown exercise type '${type}'`,
      );
    }
    const handler = (await activationOf(extension)).handlers.get(type);
    if (handler === undefined) {
      throw new RuntimeFailure(
        'activation-failed',
        `extension '${extension.id}' did not register '${type}'`,
      );
    }
    return handler;
  };

  const policyFor = async (
    extension: ResolvedExtension | undefined,
    id: string,
  ): Promise<GradePolicyHandler> => {
    if (extension === undefined) {
      throw new RuntimeFailure(
        'unknown-policy',
        `unknown grade policy '${id}'`,
      );
    }
    const handler = (await activationOf(extension)).policies.get(id);
    if (handler === undefined) {
      throw new RuntimeFailure(
        'activation-failed',
        `extension '${extension.id}' did not register '${id}'`,
      );
    }
    return handler;
  };

  const invoke = async <T>(call: () => T | Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      throw new RuntimeFailure(
        error instanceof HandlerTimeout ? 'handler-timeout' : 'handler-failed',
        messageOf(error),
      );
    }
  };

  const evaluatePolicy = async (
    extension: ResolvedExtension | undefined,
    params: Extract<ExtRequest, { method: 'gradePolicy' }>['params'],
  ): Promise<unknown> => {
    const policy = await policyFor(extension, params.policyId);
    const result = await invoke(() =>
      policy({ verdicts: params.verdicts, gaveUp: params.gaveUp }),
    );
    const parsed = gradeValueSchema.safeParse(result);
    if (!parsed.success) {
      throw new RuntimeFailure(
        'invalid-result',
        `grade policy returned ${JSON.stringify(result) ?? 'undefined'}, expected an integer 1..5 or null`,
      );
    }
    return parsed.data;
  };

  const deliverEvent = async (
    extension: ResolvedExtension | undefined,
    params: Extract<ExtRequest, { method: 'deliverEvent' }>['params'],
  ): Promise<{ delivered: boolean }> => {
    if (extension === undefined) {
      throw new RuntimeFailure(
        'unknown-type',
        `unknown extension '${params.extensionId}'`,
      );
    }
    // расширение без разрешения или объявления события не активируется ради него
    if (
      !extension.permissions.includes('learning.events') ||
      !extension.events.some(({ event }) => event === params.name)
    ) {
      return { delivered: false };
    }
    const handler = (await activationOf(extension)).events.get(params.name);
    if (handler === undefined) return { delivered: false };
    await invoke(() =>
      within(Promise.resolve(handler(params.payload)), EVENT_HANDLER_MS),
    );
    return { delivered: true };
  };

  const invokeCommand = async (
    extension: ResolvedExtension | undefined,
    params: Extract<ExtRequest, { method: 'invokeCommand' }>['params'],
  ): Promise<unknown> => {
    const { commandId } = params;
    if (!extension?.commands.some(({ id }) => id === commandId)) {
      throw new RuntimeFailure(
        'unknown-command',
        `unknown command '${commandId}' of '${params.extensionId}'`,
      );
    }
    let activation: Activation;
    try {
      activation = await activationOf(extension);
    } catch (error) {
      // сборку заменили, пока шла активация: вызывающему нужен повтор, а не сбой кода
      if (known.get(extension.id) !== extension) {
        throw new RuntimeFailure(
          'replaced',
          `extension '${extension.id}' was replaced`,
        );
      }
      throw error;
    }
    const handler = activation.commands.get(commandId);
    if (handler === undefined) {
      throw new RuntimeFailure(
        'unknown-command',
        `extension '${extension.id}' did not register command '${commandId}'`,
      );
    }
    const result = await invoke(() =>
      within(Promise.resolve(handler(params.args)), COMMAND_HANDLER_MS),
    );
    try {
      return normalizeCommandResult(
        result,
        extension.panels.map(({ id }) => id),
      );
    } catch (error) {
      if (error instanceof InvalidCommandResultError) {
        throw new RuntimeFailure('invalid-result', error.message);
      }
      throw error;
    }
  };

  const run = async (
    request: ExtRequest,
    extension: ResolvedExtension | undefined,
  ): Promise<unknown> => {
    if (request.method === 'gradePolicy') {
      return evaluatePolicy(extension, request.params);
    }
    if (request.method === 'deliverEvent') {
      return deliverEvent(extension, request.params);
    }
    if (request.method === 'invokeCommand') {
      return invokeCommand(extension, request.params);
    }
    const { params } = request;
    const handler = await handlerFor(extension, params.type);
    switch (request.method) {
      case 'project':
        return invoke(() =>
          handler.project({ exerciseId: params.exerciseId, spec: params.spec }),
        );
      case 'referenceAnswer': {
        const answer = await invoke(() =>
          handler.referenceAnswer?.({
            exerciseId: params.exerciseId,
            spec: params.spec,
          }),
        );
        return answer === undefined
          ? { found: false }
          : { found: true, answer };
      }
      case 'grade': {
        const grade = request.params;
        const result = await invoke(() =>
          handler.grade({
            exerciseId: grade.exerciseId,
            spec: grade.spec,
            answer: grade.answer,
            timeoutMs: grade.timeoutMs,
            authorMode: grade.authorMode,
          }),
        );
        const parsed = gradeResultSchema.safeParse(result);
        if (!parsed.success) {
          throw new RuntimeFailure(
            'invalid-result',
            `grade() returned an invalid result: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
          );
        }
        return parsed.data;
      }
      default: {
        // request разобран extRequestSchema, сюда попасть нельзя
        const unknown: never = request;
        throw new RuntimeFailure(
          'handler-failed',
          `unknown method ${JSON.stringify(unknown)}`,
        );
      }
    }
  };

  const disposeActivation = async (slot: Slot): Promise<void> => {
    // активация, ещё регистрирующая обработчики, дорегистрируется до освобождения
    await settledWithin(slot.ready, drainGraceMs);
    const { activation } = slot;
    if (activation === null) return;
    try {
      await activation.module.deactivate?.();
    } catch (error) {
      logger.error({ error: messageOf(error) }, 'deactivate failed');
    }
    for (const disposable of activation.disposables) {
      try {
        await disposable.dispose();
      } catch (error) {
        logger.error({ error: messageOf(error) }, 'dispose failed');
      }
    }
  };

  const disposeRunner = async (runner: RestrictedRunner): Promise<void> => {
    try {
      await runner.dispose();
    } catch (error) {
      logger.error({ error: messageOf(error) }, 'runner dispose failed');
    }
  };

  /** Освобождение в фоне: `dispose()` рантайма дожидается всех. */
  const background = (work: Promise<void>): Promise<void> => {
    retiring.add(work);
    void work.finally(() => retiring.delete(work));
    return work;
  };

  /** Выводит активацию из обращения сразу; освобождает и ждёт её. */
  const releaseActivation = async (extensionId: string): Promise<void> => {
    const slot = slots.get(extensionId);
    slots.delete(extensionId);
    if (slot !== undefined) await background(disposeActivation(slot));
  };

  const releaseRunner = async (extensionId: string): Promise<void> => {
    const runner = runners.get(extensionId);
    runners.delete(extensionId);
    if (runner !== undefined) await background(disposeRunner(runner));
  };

  /** Срок вызова, который стоит дождаться при замене набора; обработчики команды и `grade` задают его сами. */
  const budgetOf = (request: ExtRequest): number => {
    switch (request.method) {
      case 'grade':
        return request.params.timeoutMs;
      case 'invokeCommand':
        return COMMAND_HANDLER_MS;
      default:
        return DEFAULT_CALL_MS;
    }
  };

  const fly = <T>(
    extensionId: string,
    request: ExtRequest,
    work: Promise<T>,
  ): Promise<T> => {
    const budgetMs = budgetOf(request);
    const flight: Flight = {
      done: work.then(ignore, ignore),
      deadlineAt: Date.now() + budgetMs + drainGraceMs,
    };
    const set = flights.get(extensionId) ?? new Set<Flight>();
    flights.set(extensionId, set);
    set.add(flight);
    void flight.done.then(() => {
      set.delete(flight);
      if (set.size === 0 && flights.get(extensionId) === set) {
        flights.delete(extensionId);
      }
    });
    return work;
  };

  const drain = async (waiting: readonly Flight[]): Promise<void> => {
    if (waiting.length === 0) return;
    const until = Math.max(...waiting.map(({ deadlineAt }) => deadlineAt));
    await settledWithin(
      Promise.all(waiting.map(({ done }) => done)),
      until - Date.now(),
    );
  };

  /** Вытеснение при замене: активация и ограниченный процесс уходят из обращения сразу, освобождаются после вызовов в полёте. */
  const evict = async (extensionId: string): Promise<void> => {
    const waiting = [...(flights.get(extensionId) ?? [])];
    const slot = slots.get(extensionId);
    const runner = runners.get(extensionId);
    slots.delete(extensionId);
    runners.delete(extensionId);
    if (slot === undefined && runner === undefined) return;
    await background(
      (async () => {
        await drain(waiting);
        if (slot !== undefined) await disposeActivation(slot);
        if (runner !== undefined) await disposeRunner(runner);
      })(),
    );
  };

  const replace = (extensions: readonly ResolvedExtension[]): Promise<void> => {
    const previous = known;
    const next = new Map<string, ResolvedExtension>();
    const stale: string[] = [];
    for (const item of extensions) {
      const before = previous.get(item.id);
      if (before !== undefined && isDeepStrictEqual(before, item)) {
        next.set(item.id, before); // то же тождество: идущие вызовы остаются актуальными
      } else {
        next.set(item.id, item);
        if (before !== undefined) stale.push(item.id);
      }
    }
    for (const id of previous.keys()) if (!next.has(id)) stale.push(id);
    known = next;
    discovery.replace(discoveryOf([...next.values()]));
    // новые файлы — новая сводка здоровья
    for (const id of stale) reportHealth({ extensionId: id, kind: 'reset' });
    return Promise.all(stale.map(evict)).then(ignore);
  };

  const ownerOfRequest = (
    request: ExtRequest,
  ): ResolvedExtension | undefined => {
    switch (request.method) {
      case 'gradePolicy':
        return catalog.ownerOfPolicy(request.params.policyId);
      case 'deliverEvent':
      case 'invokeCommand':
        return known.get(request.params.extensionId);
      default:
        return catalog.ownerOf(request.params.type);
    }
  };

  /** Изменение настройки — работающему расширению: в процессе или в ограниченном процессе. */
  const applySettingChange = ({ params }: SettingChangedNotice): void => {
    slots
      .get(params.extensionId)
      ?.activation?.settings.apply({ id: params.id, value: params.value });
    runners
      .get(params.extensionId)
      ?.notify({ method: 'settingChanged', params });
  };

  const refused = (
    request: ExtRequest,
    message: string,
    cause: Extract<
      ExtResponse,
      { ok: false }
    >['error']['cause'] = 'activation-failed',
  ): ExtResponse => ({
    id: request.id,
    ok: false,
    error: { cause, message },
  });

  // Расширение не из поставки с isolated === true исполняется в ограниченном
  // процессе; смена режима освобождает активацию другого режима.
  const runIsolated = async (
    request: ExtRequest,
    extension: ResolvedExtension,
  ): Promise<ExtResponse> => {
    if (options.runners === undefined) {
      return refused(request, 'isolated execution is not configured');
    }
    await releaseActivation(extension.id);
    let runner = runners.get(extension.id);
    if (runner === undefined) {
      if (known.get(extension.id) !== extension) {
        return refused(
          request,
          `extension '${extension.id}' was replaced`,
          request.method === 'invokeCommand' ? 'replaced' : 'activation-failed',
        );
      }
      runner = options.runners.create(extension, engine);
      runners.set(extension.id, runner);
    }
    const response = await runner.handle(request);
    if (!response.ok) {
      logger.warn(
        { extensionId: extension.id, ...response.error },
        'restricted extension call failed',
      );
    }
    return response;
  };

  const dispatch = async (
    request: ExtRequest,
    extension: ResolvedExtension | undefined,
  ): Promise<ExtResponse> => {
    if (extension !== undefined) {
      const isolated =
        enforceIsolation &&
        request.params.isolated &&
        extension.origin !== 'bundled';
      if (isolated) return runIsolated(request, extension);
      await releaseRunner(extension.id);
    }
    try {
      return {
        id: request.id,
        ok: true,
        result: await run(request, extension),
      };
    } catch (error) {
      if (error instanceof RuntimeFailure) {
        return {
          id: request.id,
          ok: false,
          error: { cause: error.failure, message: error.message },
        };
      }
      logger.error({ error: messageOf(error) }, 'extension runtime failure');
      return {
        id: request.id,
        ok: false,
        error: { cause: 'handler-failed', message: messageOf(error) },
      };
    }
  };

  // владелец вызова определяется один раз: замена набора посреди вызова его не переключает
  const handle = (request: ExtRequest): Promise<ExtResponse> => {
    const extension = ownerOfRequest(request);
    const response = dispatch(request, extension);
    return extension === undefined
      ? response
      : fly(extension.id, request, response);
  };

  return {
    handle,
    replace,
    attach(endpoint) {
      if (current !== null) {
        failEngineRequests(current, {
          code: 'UNAVAILABLE',
          message: 'engine connection was replaced',
        });
        current.close();
      }
      current = endpoint;
      endpoint.onClose(() => {
        if (current === endpoint) current = null;
        failEngineRequests(endpoint, {
          code: 'UNAVAILABLE',
          message: 'engine connection closed',
        });
      });
      endpoint.onMessage((message) => {
        const parsed = extMessageSchema.safeParse(message);
        if (!parsed.success) {
          logger.warn({}, 'invalid extension host request ignored');
          return;
        }
        const request = parsed.data as
          ExtMessage | SettingChangedNotice | HostResponse;
        if ('ok' in request) {
          settleEngineRequest(request);
          return;
        }
        if (request.method === 'settingChanged') {
          applySettingChange(request);
          return;
        }
        if (request.method === 'replaceExtensions') {
          // подтверждение уходит, когда каталог уже заменён; вытеснение идёт следом
          void replace(request.params.extensions);
          endpoint.post({ id: request.id, ok: true, result: null });
          return;
        }
        void handle(request).then((response) => {
          endpoint.post(response);
        });
      });
    },
    async dispose() {
      if (current !== null) {
        failEngineRequests(current, {
          code: 'UNAVAILABLE',
          message: 'extension host is shutting down',
        });
        current.close();
      }
      current = null;
      for (const id of [...slots.keys()]) await releaseActivation(id);
      for (const id of [...runners.keys()]) await releaseRunner(id);
      await Promise.all([...retiring]);
    },
  };
};
