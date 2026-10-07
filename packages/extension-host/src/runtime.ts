import { pathToFileURL } from 'node:url';
import type {
  ExtensionEngine,
  MessageEndpoint,
} from '@dolphy-app/engine-contract';
import {
  EMPTY_SERVER_REGISTRATION,
  EXTENSION_COMMAND_LIMITS,
  EXTENSION_RPC_LIMITS,
  EXTENSION_SCHEDULE_LIMITS,
  EXTENSION_TRANSFER_LIMITS,
  InvalidCommandResultError,
  InvalidTransferResultError,
  normalizeCommandResult,
  normalizeExportResult,
  normalizeImportResult,
} from '@dolphy-app/extension-api';
import type {
  EntryResult,
  ExtensionLogger,
  LibraryReader,
  ServerEntry,
  ServerRegistration,
} from '@dolphy-app/extension-api';
import type { ExtensionCandidate } from './discover.ts';
import { ENGINE_REQUEST_MS, EngineRequestError } from './engine-link.ts';
import type { EngineLink } from './engine-link.ts';
import { createEngineClients } from './engine-tunnel.ts';
import type { EngineHandle } from './engine-tunnel.ts';
import {
  extMessageSchema,
  gradeResultSchema,
  gradeValueSchema,
  isJsonValue,
} from './protocol.ts';
import type {
  EngineTunnelMessage,
  ExtMessage,
  ExtRequest,
  ExtResponse,
  ExtensionRegistrationResult,
  HealthReport,
  HostFailure,
  HostResponse,
  ReplaceExtensionsResult,
  SettingChangedNotice,
} from './protocol.ts';
import { createRegistrar } from './registrar.ts';
import type { Registrar } from './registrar.ts';
import { schemaIssues } from './registrar-support.ts';
import { createSettingsState } from './state.ts';
import type { SettingsState } from './state.ts';

/** Серверная часть расширения: экспорты `main.mjs`. */
export interface ServerModule {
  server?: ServerEntry<ExtensionEngine>;
}

export interface ExtensionRuntimeOptions {
  library: LibraryReader;
  logger: ExtensionLogger;
  /** Шов для тестов: модуль расширения с этим id берётся отсюда вместо `import()`. */
  modules?: Readonly<Record<string, ServerModule>>;
  /**
   * Запас сверх срока вызова (`timeoutMs` у `grade`, 10 с у команд, 5 с у остальных), сколько
   * `replace` ждёт вызов, идущий в момент замены, прежде чем вытеснить
   * расширение. Совпадает с запасом движка до дедлайна; по умолчанию 2000.
   */
  drainGraceMs?: number;
  /**
   * Срок регистрации расширения (загрузка модуля, настройки, сам `server`):
   * не завершилась — расширение остаётся без вкладов. По умолчанию
   * `ACTIVATION_TIMEOUT_MS`.
   */
  activationTimeoutMs?: number;
}

export interface ExtensionRuntime {
  handle(request: ExtRequest): Promise<ExtResponse>;
  /**
   * Заменяет набор расширений. Расширения, которых ещё нет или у которых
   * сменились файлы (`revision`, `mainPath`), загружаются сразу и
   * параллельно: вызывается `server`, обработчики остаются в хосте, а
   * ответ несёт регистрацию каждого расширения (всё или ничего: ошибка или
   * срок — `ok: false`, вкладов нет). Неизменившиеся расширения не
   * перезапускаются. Прежний код изменившихся и убранных расширений
   * выгружается (его очистка вызывается) после вызовов, шедших в момент замены
   * (не дольше их срока и запаса); на ответ это не влияет.
   */
  replace(
    candidates: readonly ExtensionCandidate[],
  ): Promise<ReplaceExtensionsResult>;
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

/** Срок регистрации расширения (`server` вместе с загрузкой модуля); параллельно, на каждое расширение. */
export const ACTIVATION_TIMEOUT_MS = 10_000;

/** Срок обработчика события обучения (R6). */
export const EVENT_HANDLER_MS = 2000;

/** Срок обработчика расписания (R12); клиент планировщика ждёт дольше. */
export const SCHEDULE_HANDLER_MS = EXTENSION_SCHEDULE_LIMITS.handlerMs;

/** Срок обработчика команды расширения (R3); клиент движка ждёт дольше. */
export const COMMAND_HANDLER_MS = EXTENSION_COMMAND_LIMITS.handlerMs;

/** Срок обработчика `server.handle`; клиент движка ждёт дольше. */
export const RPC_HANDLER_MS = EXTENSION_RPC_LIMITS.handlerMs;

/** Срок обработчика импортёра и экспортёра; клиент движка (34 с) ждёт дольше. */
export const TRANSFER_HANDLER_MS = EXTENSION_TRANSFER_LIMITS.handlerMs;

const ignore = (): void => {};

/** Обработчик не уложился в срок: `invoke` превращает её в `handler-timeout`. */
class HandlerTimeout extends Error {}

/** Регистрация не уложилась в срок. */
class ActivationTimeout extends Error {}

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

/** Загруженное расширение: его регистратор держит обработчики, `cleanup` — то, что вернул `server`. */
interface Loaded {
  candidate: ExtensionCandidate;
  registration: ServerRegistration;
  registrar: Registrar;
  settings: SettingsState;
  cleanup: EntryResult;
  /** Клиент движка расширения (`server.engine`): отпускается при выгрузке. */
  engine: EngineHandle;
  /** Обработчики расписаний, которые ещё работают: срок вышел, а код не вернулся — следующее срабатывание пропускается. */
  firing: Set<string>;
}

/** Исход регистрации одного расширения. */
type Activation =
  | { ok: true; loaded: Loaded | null; registration: ServerRegistration }
  | {
      ok: false;
      cause: 'activation-failed' | 'activation-timeout';
      error: string;
    };

/** Запрос хоста к движку, ожидающий ответа. */
interface EnginePending {
  endpoint: MessageEndpoint;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/** Вызов, идущий прямо сейчас; `deadlineAt` — до какого момента его стоит ждать при замене. */
interface Flight {
  done: Promise<void>;
  deadlineAt: number;
}

/**
 * Логгер расширения: каждая запись несёт `extensionId`, по нему журнал
 * фильтруется. Поле ставится после полей вызова, чтобы расширение не могло
 * подписаться чужим id.
 */
const scopedLogger = (
  base: ExtensionLogger,
  extensionId: string,
): ExtensionLogger => ({
  debug: (fields, message) => base.debug({ ...fields, extensionId }, message),
  info: (fields, message) => base.info({ ...fields, extensionId }, message),
  warn: (fields, message) => base.warn({ ...fields, extensionId }, message),
  error: (fields, message) => base.error({ ...fields, extensionId }, message),
});

/** Очистка, которую вернул `server`: функция или `Disposable`. */
const runCleanup = async (cleanup: EntryResult): Promise<void> => {
  if (typeof cleanup === 'function') await cleanup();
  else if (cleanup !== undefined && cleanup !== null) await cleanup.dispose();
};

export const createExtensionRuntime = (
  options: ExtensionRuntimeOptions,
): ExtensionRuntime => {
  const { logger } = options;
  const drainGraceMs = options.drainGraceMs ?? 2000;
  const activationTimeoutMs =
    options.activationTimeoutMs ?? ACTIVATION_TIMEOUT_MS;
  let loaded = new Map<string, Loaded>();
  const flights = new Map<string, Set<Flight>>();
  const retiring = new Set<Promise<void>>();
  // загрузчик ESM не вытесняет модули: каждая загрузка получает свой `?v=`
  const loads = new Map<string, number>();
  // замены идут по очереди: следующая видит итог предыдущей
  let replacing: Promise<unknown> = Promise.resolve();
  let replaceCount = 0;
  let current: MessageEndpoint | null = null;
  const engineClients = createEngineClients(logger);
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

  /** Сообщение о здоровье движку: учёт не должен ломать вызов, поэтому отказ канала молча теряется. */
  const reportHealth = (report: HealthReport): void => {
    engine.request('health.report', report).catch(ignore);
  };

  const loadServer = async (
    candidate: ExtensionCandidate,
  ): Promise<ServerEntry<ExtensionEngine>> => {
    let module = options.modules?.[candidate.id];
    if (module === undefined) {
      const load = (loads.get(candidate.id) ?? 0) + 1;
      loads.set(candidate.id, load);
      const url = `${pathToFileURL(candidate.mainPath ?? '').href}?v=${load}`;
      module = (await import(url)) as ServerModule;
    }
    if (typeof module.server !== 'function') {
      throw new Error('main.mjs does not export server');
    }
    return module.server;
  };

  /** Загружает модуль, вызывает `server`, подгружает настройки; всё или ничего. */
  const register = async (
    candidate: ExtensionCandidate,
    registrar: Registrar,
    settings: SettingsState,
    engineHandle: EngineHandle,
  ): Promise<Loaded> => {
    try {
      const server = await loadServer(candidate);
      const cleanup = await server(registrar.context);
      registrar.seal();
      // значения настроек известны движку по определениям, поэтому грузятся после регистрации
      await settings.load(() =>
        engine.request('settings.all', { extensionId: candidate.id }),
      );
      return {
        candidate,
        registration: registrar.snapshot(),
        registrar,
        settings,
        cleanup,
        firing: new Set(),
        engine: engineHandle,
      };
    } catch (error) {
      registrar.seal();
      settings.dispose();
      throw error;
    }
  };

  const drain = async (waiting: readonly Flight[]): Promise<void> => {
    if (waiting.length === 0) return;
    const until = Math.max(...waiting.map(({ deadlineAt }) => deadlineAt));
    await settledWithin(
      Promise.all(waiting.map(({ done }) => done)),
      until - Date.now(),
    );
  };

  /** Выгрузка: вызовы, шедшие в момент замены, договаривают, затем очистка расширения. */
  const retire = async (
    item: Loaded,
    waiting: readonly Flight[] = [],
  ): Promise<void> => {
    await drain(waiting);
    item.settings.dispose();
    try {
      await runCleanup(item.cleanup);
    } catch (error) {
      logger.error(
        { extensionId: item.candidate.id, error: messageOf(error) },
        'extension cleanup failed',
      );
    } finally {
      item.engine.release();
    }
  };

  const activate = async (
    candidate: ExtensionCandidate,
  ): Promise<Activation> => {
    if (
      candidate.mainPath === null &&
      options.modules?.[candidate.id] === undefined
    ) {
      return {
        ok: true,
        loaded: null,
        registration: EMPTY_SERVER_REGISTRATION,
      };
    }
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    const settings = createSettingsState(candidate.id, logger);
    const engineHandle = engineClients.open(candidate.id);
    const registrar = createRegistrar({
      extensionId: candidate.id,
      logger: scopedLogger(logger, candidate.id),
      library: options.library,
      engine,
      engineClient: engineHandle.engine,
      settings,
    });
    const work = register(candidate, registrar, settings, engineHandle);
    // опоздавший итог не должен остаться без владельца: его очистка вызывается сразу
    work.then((late) => {
      if (expired) void retire(late);
    }, ignore);
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        registrar.seal();
        expired = true;
        reject(
          new ActivationTimeout(
            `server() did not finish in ${activationTimeoutMs} ms (the engine starts after registration: do not await s.engine inside server(), call it from handlers)`,
          ),
        );
      }, activationTimeoutMs);
    });
    try {
      const result = await Promise.race([work, timeout]);
      reportHealth({
        extensionId: candidate.id,
        kind: 'activated',
        durationMs: Math.round(performance.now() - started),
      });
      return { ok: true, loaded: result, registration: result.registration };
    } catch (error) {
      const cause =
        error instanceof ActivationTimeout
          ? 'activation-timeout'
          : 'activation-failed';
      logger.warn(
        { extensionId: candidate.id, cause, error: messageOf(error) },
        'extension registration failed',
      );
      reportHealth({
        extensionId: candidate.id,
        kind: 'failed',
        reason: cause,
        message: messageOf(error),
      });
      engineHandle.release();
      return { ok: false, cause, error: messageOf(error) };
    } finally {
      clearTimeout(timer);
    }
  };

  /** Освобождение в фоне: `dispose()` рантайма дожидается всех. */
  const background = (work: Promise<void>): void => {
    retiring.add(work);
    void work.finally(() => retiring.delete(work));
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

  /** Результат импортёра или экспортёра, не прошедший проверку формы и потолков, — `invalid-result`. */
  const checkedTransfer = <T>(check: () => T): T => {
    try {
      return check();
    } catch (error) {
      if (error instanceof InvalidTransferResultError) {
        throw new RuntimeFailure('invalid-result', error.message);
      }
      throw error;
    }
  };

  const utf8Bytes = (text: string): number => Buffer.byteLength(text);

  const requireOwner = (
    owner: Loaded | undefined,
    extensionId: string,
  ): Loaded => {
    if (owner === undefined) {
      throw new RuntimeFailure(
        'unknown-type',
        `unknown extension '${extensionId}'`,
      );
    }
    return owner;
  };

  const evaluatePolicy = async (
    owner: Loaded | undefined,
    params: Extract<ExtRequest, { method: 'gradePolicy' }>['params'],
  ): Promise<unknown> => {
    const handler = owner?.registrar.handlers.gradePolicies.get(
      params.policyId,
    )?.handler;
    if (handler === undefined) {
      throw new RuntimeFailure(
        'unknown-policy',
        `unknown grade policy '${params.policyId}'`,
      );
    }
    const result = await invoke(() =>
      handler({ verdicts: params.verdicts, gaveUp: params.gaveUp }),
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
    owner: Loaded | undefined,
    params: Extract<ExtRequest, { method: 'deliverEvent' }>['params'],
  ): Promise<{ delivered: boolean }> => {
    const handler = requireOwner(
      owner,
      params.extensionId,
    ).registrar.handlers.events.get(params.name);
    if (handler === undefined) return { delivered: false };
    await invoke(() =>
      within(Promise.resolve(handler(params.payload)), EVENT_HANDLER_MS),
    );
    return { delivered: true };
  };

  const fireSchedule = async (
    owner: Loaded | undefined,
    params: Extract<ExtRequest, { method: 'fireSchedule' }>['params'],
  ): Promise<{ delivered: boolean }> => {
    const extension = requireOwner(owner, params.extensionId);
    const handler = extension.registrar.handlers.schedules.get(
      params.scheduleId,
    )?.handler;
    if (handler === undefined) return { delivered: false };
    if (extension.firing.has(params.scheduleId)) {
      logger.warn(
        { extensionId: params.extensionId, scheduleId: params.scheduleId },
        'schedule handler is still running, the firing is skipped',
      );
      return { delivered: false };
    }
    const running = Promise.resolve().then(() => handler());
    extension.firing.add(params.scheduleId);
    // обработчик, не уложившийся в срок, продолжает работать: расписание свободно, когда вернётся он сам
    const release = (): void => {
      extension.firing.delete(params.scheduleId);
    };
    running.then(release, release);
    await invoke(() => within(running, SCHEDULE_HANDLER_MS));
    return { delivered: true };
  };

  const runImporter = async (
    owner: Loaded | undefined,
    params: Extract<ExtRequest, { method: 'runImporter' }>['params'],
  ): Promise<unknown> => {
    const { importerId } = params;
    const entry = owner?.registrar.handlers.importers.get(importerId);
    if (entry === undefined) {
      throw new RuntimeFailure(
        'unknown-importer',
        `unknown importer '${importerId}' of '${params.extensionId}'`,
      );
    }
    const size =
      'text' in params ? utf8Bytes(params.text) : params.bytes.byteLength;
    if (size > EXTENSION_TRANSFER_LIMITS.inputBytes) {
      throw new RuntimeFailure(
        'handler-failed',
        `the file is longer than ${EXTENSION_TRANSFER_LIMITS.inputBytes} bytes`,
      );
    }
    if (('text' in params ? 'text' : 'bytes') !== entry.meta.input) {
      throw new RuntimeFailure(
        'handler-failed',
        `importer '${importerId}' takes ${entry.meta.input} input`,
      );
    }
    const input =
      'text' in params
        ? { name: params.name, text: params.text }
        : { name: params.name, bytes: params.bytes };
    const result = await invoke(() =>
      within(Promise.resolve(entry.handler(input)), TRANSFER_HANDLER_MS),
    );
    return checkedTransfer(() => normalizeImportResult(result));
  };

  const runExporter = async (
    owner: Loaded | undefined,
    params: Extract<ExtRequest, { method: 'runExporter' }>['params'],
  ): Promise<unknown> => {
    const { exporterId, input } = params;
    const entry = owner?.registrar.handlers.exporters.get(exporterId);
    if (entry === undefined) {
      throw new RuntimeFailure(
        'unknown-exporter',
        `unknown exporter '${exporterId}' of '${params.extensionId}'`,
      );
    }
    if (input.scope !== entry.meta.scope) {
      throw new RuntimeFailure(
        'handler-failed',
        `exporter '${exporterId}' takes the ${entry.meta.scope} scope`,
      );
    }
    if (
      input.scope === 'course' &&
      Object.values(input.files).reduce(
        (sum, text) => sum + utf8Bytes(text),
        0,
      ) > EXTENSION_TRANSFER_LIMITS.totalBytes
    ) {
      throw new RuntimeFailure(
        'handler-failed',
        `the course files are longer than ${EXTENSION_TRANSFER_LIMITS.totalBytes} bytes`,
      );
    }
    const result = await invoke(() =>
      within(Promise.resolve(entry.handler(input)), TRANSFER_HANDLER_MS),
    );
    return checkedTransfer(() => normalizeExportResult(result));
  };

  const invokeCommand = async (
    owner: Loaded | undefined,
    params: Extract<ExtRequest, { method: 'invokeCommand' }>['params'],
  ): Promise<unknown> => {
    const { commandId } = params;
    const handler = owner?.registrar.handlers.commands.get(commandId)?.handler;
    if (handler === undefined) {
      throw new RuntimeFailure(
        'unknown-command',
        `unknown command '${commandId}' of '${params.extensionId}'`,
      );
    }
    const result = await invoke(() =>
      within(Promise.resolve(handler(params.args)), COMMAND_HANDLER_MS),
    );
    try {
      // панели регистрирует окно: хост не знает их id, окно проверяет `openPanel` само
      return normalizeCommandResult(result, undefined);
    } catch (error) {
      if (error instanceof InvalidCommandResultError) {
        throw new RuntimeFailure('invalid-result', error.message);
      }
      throw error;
    }
  };

  const invokeRpc = async (
    owner: Loaded | undefined,
    params: Extract<ExtRequest, { method: 'invokeRpc' }>['params'],
  ): Promise<unknown> => {
    const { name } = params;
    const entry = owner?.registrar.handlers.rpcs.get(name);
    if (entry === undefined) {
      throw new RuntimeFailure(
        'unknown-rpc',
        `unknown rpc '${name}' of '${params.extensionId}'`,
      );
    }
    const { contract, handler } = entry;
    const input = await contract.input.safeParseAsync(params.input);
    if (!input.success) {
      throw new RuntimeFailure(
        'invalid-input',
        `invalid input of '${name}': ${schemaIssues(input.error).join('; ')}`,
      );
    }
    const result = await invoke(() =>
      within(Promise.resolve(handler(input.data)), RPC_HANDLER_MS),
    );
    const output = await contract.output.safeParseAsync(result);
    if (!output.success) {
      throw new RuntimeFailure(
        'invalid-result',
        `invalid result of '${name}': ${schemaIssues(output.error).join('; ')}`,
      );
    }
    // `undefined` (контракт с `z.void()`) допустим: ключ `result` у него просто отсутствует
    if (output.data !== undefined && !isJsonValue(output.data)) {
      throw new RuntimeFailure(
        'invalid-result',
        `the result of '${name}' is not JSON`,
      );
    }
    return output.data;
  };

  const run = async (
    request: ExtRequest,
    owner: Loaded | undefined,
  ): Promise<unknown> => {
    switch (request.method) {
      case 'gradePolicy':
        return evaluatePolicy(owner, request.params);
      case 'deliverEvent':
        return deliverEvent(owner, request.params);
      case 'fireSchedule':
        return fireSchedule(owner, request.params);
      case 'invokeCommand':
        return invokeCommand(owner, request.params);
      case 'invokeRpc':
        return invokeRpc(owner, request.params);
      case 'runImporter':
        return runImporter(owner, request.params);
      case 'runExporter':
        return runExporter(owner, request.params);
      default:
        break;
    }
    const { params } = request;
    const handler = owner?.registrar.handlers.exerciseTypes.get(
      params.type,
    )?.handler;
    if (handler === undefined) {
      throw new RuntimeFailure(
        'unknown-type',
        `unknown exercise type '${params.type}'`,
      );
    }
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

  /** Срок вызова, который стоит дождаться при замене набора; обработчики команды и `grade` задают его сами. */
  const budgetOf = (request: ExtRequest): number => {
    switch (request.method) {
      case 'grade':
        return request.params.timeoutMs;
      case 'fireSchedule':
        return SCHEDULE_HANDLER_MS;
      case 'invokeCommand':
        return COMMAND_HANDLER_MS;
      case 'invokeRpc':
        return RPC_HANDLER_MS;
      case 'runImporter':
      case 'runExporter':
        return TRANSFER_HANDLER_MS;
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

  const doReplace = async (
    candidates: readonly ExtensionCandidate[],
  ): Promise<ReplaceExtensionsResult> => {
    const previous = loaded;
    const next = new Map<string, Loaded>();
    const stale: Loaded[] = [];
    const outcomes = await Promise.all(
      candidates.map(
        async (candidate): Promise<ExtensionRegistrationResult> => {
          const before = previous.get(candidate.id);
          if (
            before !== undefined &&
            before.candidate.revision === candidate.revision &&
            before.candidate.mainPath === candidate.mainPath
          ) {
            before.candidate = candidate;
            next.set(candidate.id, before);
            return { ok: true, registration: before.registration };
          }
          if (before !== undefined) stale.push(before);
          const activation = await activate(candidate);
          if (!activation.ok) return { ok: false, error: activation.error };
          if (activation.loaded !== null) {
            next.set(candidate.id, activation.loaded);
          }
          return { ok: true, registration: activation.registration };
        },
      ),
    );
    for (const [id, item] of previous) {
      if (!next.has(id) && !stale.includes(item)) stale.push(item);
    }
    loaded = next;
    for (const item of stale) {
      // новые файлы — новая сводка здоровья
      reportHealth({ extensionId: item.candidate.id, kind: 'reset' });
      background(retire(item, [...(flights.get(item.candidate.id) ?? [])]));
    }
    return {
      registrations: Object.fromEntries(
        candidates.map(({ id }, index) => [id, outcomes[index]]),
      ) as Record<string, ExtensionRegistrationResult>,
    };
  };

  const replace = (
    candidates: readonly ExtensionCandidate[],
  ): Promise<ReplaceExtensionsResult> => {
    replaceCount++;
    const result = replacing.then(() => doReplace(candidates));
    replacing = result.then(ignore, ignore).finally(() => replaceCount--);
    return result;
  };

  const ownerOfRequest = (request: ExtRequest): Loaded | undefined => {
    switch (request.method) {
      case 'gradePolicy':
        return [...loaded.values()].find((item) =>
          item.registrar.handlers.gradePolicies.has(request.params.policyId),
        );
      case 'deliverEvent':
      case 'fireSchedule':
      case 'invokeCommand':
      case 'invokeRpc':
      case 'runImporter':
      case 'runExporter':
        return loaded.get(request.params.extensionId);
      default:
        return [...loaded.values()].find((item) =>
          item.registrar.handlers.exerciseTypes.has(request.params.type),
        );
    }
  };

  const execute = async (
    request: ExtRequest,
    owner: Loaded | undefined,
  ): Promise<ExtResponse> => {
    try {
      return {
        id: request.id,
        ok: true,
        result: await run(request, owner),
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
  const handle = async (request: ExtRequest): Promise<ExtResponse> => {
    let owner = ownerOfRequest(request);
    // расширения, чья регистрация ещё идёт, не «неизвестны»: вызов ждёт её итога
    if (owner === undefined && replaceCount > 0) {
      await replacing;
      owner = ownerOfRequest(request);
    }
    const response = execute(request, owner);
    return owner === undefined
      ? response
      : fly(owner.candidate.id, request, response);
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
      engineClients.connect(endpoint);
      endpoint.onClose(() => {
        if (current === endpoint) {
          current = null;
          engineClients.connect(null);
        }
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
          | ExtMessage
          | SettingChangedNotice
          | EngineTunnelMessage
          | HostResponse;
        if ('ok' in request) {
          settleEngineRequest(request);
          return;
        }
        if (request.method === 'settingChanged') {
          loaded.get(request.params.extensionId)?.settings.apply({
            id: request.params.id,
            value: request.params.value,
          });
          return;
        }
        if (
          request.method === 'engineFrame' ||
          request.method === 'engineDetach'
        ) {
          engineClients.receive(request);
          return;
        }
        if (request.method === 'replaceExtensions') {
          void replace(request.params.extensions).then((result) => {
            endpoint.post({ id: request.id, ok: true, result });
          });
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
      await replacing;
      const items = [...loaded.values()];
      loaded = new Map();
      for (const item of items) background(retire(item));
      await Promise.all([...retiring]);
      engineClients.closeAll();
    },
  };
};
