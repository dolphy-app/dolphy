import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import type { MessageEndpoint } from '@dolphy-app/engine-contract';
import type {
  Disposable,
  ExerciseTypeHandler,
  ExtensionContext,
  ExtensionLogger,
  ExtensionModule,
  GradePolicyHandler,
  LibraryReader,
} from '@dolphy-app/extension-api';
import { createCatalog } from './catalog.ts';
import type { ResolvedExtension } from './discover.ts';
import { createDiscoveryHolder, discoveryOf } from './holder.ts';
import { createAllTrustedPolicy } from './policy.ts';
import {
  extMessageSchema,
  gradeResultSchema,
  gradeValueSchema,
} from './protocol.ts';
import type { ExtMessage, ExtRequest, ExtResponse } from './protocol.ts';
import type { RestrictedRunner, RunnerFactory } from './restricted-runner.ts';

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
   * Запас сверх срока вызова (`timeoutMs` у `grade`, 5 с у остальных), сколько
   * `replace` ждёт вызов, идущий в момент замены, прежде чем вытеснить
   * расширение. Совпадает с запасом движка до дедлайна; по умолчанию 2000.
   */
  drainGraceMs?: number;
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

const ignore = (): void => {};

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
  disposables: Disposable[];
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

  const activate = async (
    extension: ResolvedExtension,
    created: (activation: Activation) => void,
  ): Promise<Activation> => {
    const module = await loadModule(extension);
    const declared = new Set(extension.exerciseTypes.map((type) => type.id));
    const declaredPolicies = new Set(
      extension.gradePolicies.map((policy) => policy.id),
    );
    const activation: Activation = {
      module,
      handlers: new Map(),
      policies: new Map(),
      disposables: [],
    };
    created(activation);
    const context: ExtensionContext = {
      extensionId: extension.id,
      logger: options.logger,
      library: options.library,
      registerExerciseType(type, handler) {
        if (!declared.has(type)) {
          throw new Error(
            `exercise type '${type}' is not declared in the manifest of '${extension.id}'`,
          );
        }
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

  const openSlot = (extension: ResolvedExtension): Slot => {
    let created: Activation | null = null;
    const ready = activate(extension, (activation) => {
      created = activation;
    });
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
      throw new RuntimeFailure('handler-failed', messageOf(error));
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

  const run = async (
    request: ExtRequest,
    extension: ResolvedExtension | undefined,
  ): Promise<unknown> => {
    if (request.method === 'gradePolicy') {
      return evaluatePolicy(extension, request.params);
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

  const fly = <T>(
    extensionId: string,
    request: ExtRequest,
    work: Promise<T>,
  ): Promise<T> => {
    const budgetMs =
      request.method === 'grade' ? request.params.timeoutMs : DEFAULT_CALL_MS;
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
    return Promise.all(stale.map(evict)).then(ignore);
  };

  const ownerOfRequest = (
    request: ExtRequest,
  ): ResolvedExtension | undefined =>
    request.method === 'gradePolicy'
      ? catalog.ownerOfPolicy(request.params.policyId)
      : catalog.ownerOf(request.params.type);

  const refused = (request: ExtRequest, message: string): ExtResponse => ({
    id: request.id,
    ok: false,
    error: { cause: 'activation-failed', message },
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
        return refused(request, `extension '${extension.id}' was replaced`);
      }
      runner = options.runners.create(extension);
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
      current?.close();
      current = endpoint;
      endpoint.onMessage((message) => {
        const parsed = extMessageSchema.safeParse(message);
        if (!parsed.success) {
          logger.warn({}, 'invalid extension host request ignored');
          return;
        }
        const request = parsed.data as ExtMessage;
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
      current?.close();
      current = null;
      for (const id of [...slots.keys()]) await releaseActivation(id);
      for (const id of [...runners.keys()]) await releaseRunner(id);
      await Promise.all([...retiring]);
    },
  };
};
