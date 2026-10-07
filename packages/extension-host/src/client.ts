import {
  ExerciseTypeError,
  ExtensionCommandError,
  ExtensionRpcError,
  ExtensionTransferError,
  GradePolicyError,
} from '@dolphy-app/engine/ports';
import type {
  ExerciseTypeErrorCause,
  ExerciseTypes,
  ExtensionCommandErrorCause,
  ExtensionCommands,
  ExtensionHealth,
  ExtensionRpc,
  ExtensionRpcErrorCause,
  ExtensionTransferErrorCause,
  ExtensionTransfers,
  GradePolicies,
  GradePolicyErrorCause,
  RawVerdict,
} from '@dolphy-app/engine/ports';
import {
  InvalidTransferResultError,
  normalizeExportResult,
  normalizeImportResult,
} from '@dolphy-app/extension-api';
import type { ExtensionLogger } from '@dolphy-app/extension-api';
import type { createCatalog } from './catalog.ts';
import type { ChannelOutcome, ChannelParams, HostChannel } from './channel.ts';
import {
  commandOutcomeSchema,
  gradeResultSchema,
  gradeValueSchema,
  isFault,
} from './protocol.ts';
import type { ExtFailureCause, ExtResponse } from './protocol.ts';

/**
 * Причины, которые вид задания не различает, сводятся к сбою обработчика;
 * `activation-timeout` — к `activation-failed` (срок активации — внутренняя причина хоста).
 */
const exerciseCause = (cause: ExtFailureCause): ExerciseTypeErrorCause => {
  switch (cause) {
    case 'activation-timeout':
      return 'activation-failed';
    case 'unknown-policy':
    case 'unknown-command':
    case 'unknown-rpc':
    case 'invalid-input':
    case 'unknown-importer':
    case 'unknown-exporter':
    case 'handler-timeout':
    case 'ipc-size':
    case 'ipc-rate':
    case 'replaced':
      return 'handler-failed';
    default:
      return cause;
  }
};

export interface RemoteExerciseTypesOptions {
  channel: HostChannel;
  catalog: ReturnType<typeof createCatalog>;
  logger: ExtensionLogger;
  /** Дедлайн `grade` = `timeoutMs + graceMs`. */
  graceMs?: number;
  projectTimeoutMs?: number;
  /** Сюда идут сбои видов заданий (отказ обработчика, неверный результат, срок); без него не учитываются. */
  health?: Pick<ExtensionHealth, 'recordFailure'>;
}

export interface RemoteGradePoliciesOptions {
  channel: HostChannel;
  catalog: ReturnType<typeof createCatalog>;
  logger: ExtensionLogger;
  deadlineMs?: number;
}

export const createRemoteExerciseTypes = (
  options: RemoteExerciseTypesOptions,
): ExerciseTypes => {
  const { catalog, channel, health } = options;
  const graceMs = options.graceMs ?? 2000;
  const projectTimeoutMs = options.projectTimeoutMs ?? 5000;

  /** Сбой вида задания записывается на расширение-владельца. */
  const recordFault = (type: string, reason: string, message: string): void => {
    const owner = catalog.ownerOf(type);
    if (owner !== undefined) health?.recordFailure(owner.id, reason, message);
  };

  const failure = (
    type: string,
    outcome: Exclude<ChannelOutcome, { kind: 'response' }>,
  ): ExerciseTypeError => {
    if (outcome.kind === 'timeout') {
      recordFault(type, 'timeout', 'extension call timed out');
      return new ExerciseTypeError('timeout', type, 'extension call timed out');
    }
    return new ExerciseTypeError('host-down', type, 'extension host is down');
  };

  const request = async (
    method: 'project' | 'referenceAnswer',
    params: ChannelParams<'project'>,
  ): Promise<unknown> => {
    const outcome = await channel.call(method, params, projectTimeoutMs);
    if (outcome.kind !== 'response') throw failure(params.type, outcome);
    const { response } = outcome;
    if (!response.ok) {
      const { cause } = response.error;
      if (isFault(cause)) {
        recordFault(params.type, cause, response.error.message);
      }
      throw new ExerciseTypeError(
        exerciseCause(cause),
        params.type,
        response.error.message,
      );
    }
    return response.result;
  };

  const toVerdict = (
    type: string,
    response: ExtResponse,
    durationMs: number,
    authorMode: boolean,
  ): RawVerdict => {
    if (!response.ok) {
      if (isFault(response.error.cause)) {
        recordFault(type, response.error.cause, response.error.message);
      }
      return {
        outcome: 'error',
        reason: 'internal',
        durationMs,
        ...(authorMode && { feedback: response.error.message.slice(0, 4000) }),
      };
    }
    const parsed = gradeResultSchema.safeParse(response.result);
    if (!parsed.success) {
      recordFault(
        type,
        'invalid-result',
        'extension returned an invalid grade result',
      );
      return { outcome: 'error', reason: 'internal', durationMs };
    }
    const result = parsed.data;
    const common = {
      durationMs,
      ...(result.feedback !== undefined && { feedback: result.feedback }),
      ...(result.data !== undefined && { data: result.data }),
    };
    if (result.outcome === 'passed') return { outcome: 'passed', ...common };
    if (result.outcome === 'failed') {
      return {
        outcome: 'failed',
        reason: result.reason,
        ...(result.detail !== undefined && { detail: result.detail }),
        ...common,
      };
    }
    return { outcome: 'error', reason: result.reason, ...common };
  };

  return {
    describe: catalog.describe,
    list: catalog.list,
    validateSpec: catalog.validateSpec,
    validateAnswer: catalog.validateAnswer,

    project: (req) => request('project', req),

    async referenceAnswer(req) {
      const result = (await request('referenceAnswer', req)) as
        { found: true; answer: unknown } | { found: false };
      return result;
    },

    async grade(req) {
      const started = performance.now();
      const outcome = await channel.call('grade', req, req.timeoutMs + graceMs);
      const durationMs = Math.round(performance.now() - started);
      switch (outcome.kind) {
        case 'response':
          return toVerdict(
            req.type,
            outcome.response,
            durationMs,
            req.authorMode,
          );
        case 'timeout':
          recordFault(req.type, 'timeout', 'extension grade timed out');
          return { outcome: 'error', reason: 'timeout', durationMs };
        default:
          return { outcome: 'error', reason: 'worker_crash', durationMs };
      }
    },

    /** Канал общий с клиентом правил оценки: закрытие движка закрывает оба. */
    close: () => channel.close(),
  };
};

const POLICY_DEADLINE_MS = 2000;

const policyCause = (cause: ExtFailureCause): GradePolicyErrorCause =>
  cause === 'unknown-policy' || cause === 'invalid-result'
    ? cause
    : 'handler-failed';

export const createRemoteGradePolicies = (
  options: RemoteGradePoliciesOptions,
): GradePolicies => {
  const { catalog, channel, logger } = options;
  const deadlineMs = options.deadlineMs ?? POLICY_DEADLINE_MS;
  return {
    list: catalog.describePolicies,

    async evaluate(id, { verdicts, gaveUp }) {
      const outcome = await channel.call(
        'gradePolicy',
        {
          policyId: id,
          verdicts: verdicts.map((verdict) => ({
            outcome: verdict.outcome,
            ...(verdict.outcome !== 'passed' && { reason: verdict.reason }),
          })),
          gaveUp,
        },
        deadlineMs,
      );
      if (outcome.kind === 'timeout') {
        throw new GradePolicyError('timeout', id, 'grade policy timed out');
      }
      if (outcome.kind !== 'response') {
        throw new GradePolicyError('host-down', id, 'extension host is down');
      }
      const { response } = outcome;
      if (!response.ok) {
        const cause = policyCause(response.error.cause);
        logger.debug({ policyId: id, cause }, 'grade policy call failed');
        throw new GradePolicyError(cause, id, response.error.message);
      }
      const parsed = gradeValueSchema.safeParse(response.result);
      if (!parsed.success) {
        throw new GradePolicyError(
          'invalid-result',
          id,
          'grade policy returned an invalid result',
        );
      }
      return parsed.data;
    },
  };
};

/**
 * Срок вызова команды у движка: больше обработчика (10 с), с запасом на
 * передачу по каналу.
 */
export const COMMAND_CLIENT_DEADLINE_MS = 14_000;

export interface RemoteExtensionCommandsOptions {
  channel: HostChannel;
  logger: ExtensionLogger;
  deadlineMs?: number;
}

const commandCause = (cause: ExtFailureCause): ExtensionCommandErrorCause => {
  switch (cause) {
    case 'unknown-command':
    case 'invalid-result':
    case 'replaced':
    case 'handler-failed':
    case 'activation-timeout':
      return cause;
    case 'handler-timeout':
      return 'timeout';
    default:
      return 'handler-failed';
  }
};

export const createRemoteExtensionCommands = (
  options: RemoteExtensionCommandsOptions,
): ExtensionCommands => {
  const { channel, logger } = options;
  const deadlineMs = options.deadlineMs ?? COMMAND_CLIENT_DEADLINE_MS;
  return {
    async invoke(extensionId, commandId, args) {
      const fail = (
        cause: ExtensionCommandErrorCause,
        message: string,
      ): ExtensionCommandError =>
        new ExtensionCommandError(cause, extensionId, commandId, message);
      // таймаут команды хост не перезапускает: клик пользователя не должен убивать чужие вызовы
      const outcome = await channel.call(
        'invokeCommand',
        {
          extensionId,
          commandId,
          ...(args !== undefined && { args }),
        },
        deadlineMs,
        { restart: false },
      );
      if (outcome.kind === 'timeout') {
        throw fail('timeout', 'extension command timed out');
      }
      if (outcome.kind !== 'response') {
        throw fail('host-down', 'extension host is down');
      }
      const { response } = outcome;
      if (!response.ok) {
        const cause = commandCause(response.error.cause);
        logger.debug(
          { extensionId, commandId, cause },
          'extension command failed',
        );
        throw fail(cause, response.error.message);
      }
      const parsed = commandOutcomeSchema.safeParse(response.result);
      if (!parsed.success) {
        throw fail(
          'invalid-result',
          'extension command returned an invalid result',
        );
      }
      const { data } = parsed;
      if (data.kind !== 'openPanel') return data;
      return data.props === undefined
        ? { kind: 'openPanel', panelId: data.panelId }
        : { kind: 'openPanel', panelId: data.panelId, props: data.props };
    },
  };
};

/**
 * Срок вызова RPC у движка: больше обработчика (10 с), с запасом на передачу
 * по каналу.
 */
export const RPC_CLIENT_DEADLINE_MS = 14_000;

export interface RemoteExtensionRpcOptions {
  channel: HostChannel;
  logger: ExtensionLogger;
  deadlineMs?: number;
}

const rpcCause = (cause: ExtFailureCause): ExtensionRpcErrorCause => {
  switch (cause) {
    case 'unknown-rpc':
    case 'invalid-input':
    case 'invalid-result':
    case 'replaced':
    case 'handler-failed':
    case 'activation-timeout':
      return cause;
    case 'handler-timeout':
      return 'timeout';
    default:
      return 'handler-failed';
  }
};

export const createRemoteExtensionRpc = (
  options: RemoteExtensionRpcOptions,
): ExtensionRpc => {
  const { channel, logger } = options;
  const deadlineMs = options.deadlineMs ?? RPC_CLIENT_DEADLINE_MS;
  return {
    async invoke(extensionId, name, input) {
      const fail = (
        cause: ExtensionRpcErrorCause,
        message: string,
      ): ExtensionRpcError =>
        new ExtensionRpcError(cause, extensionId, name, message);
      // таймаут вызова хост не перезапускает: запрос окна не должен убивать чужие вызовы
      const outcome = await channel.call(
        'invokeRpc',
        {
          extensionId,
          name,
          ...(input !== undefined && { input }),
        },
        deadlineMs,
        { restart: false },
      );
      if (outcome.kind === 'timeout') {
        throw fail('timeout', 'extension rpc timed out');
      }
      if (outcome.kind !== 'response') {
        throw fail('host-down', 'extension host is down');
      }
      const { response } = outcome;
      if (!response.ok) {
        const cause = rpcCause(response.error.cause);
        logger.debug({ extensionId, name, cause }, 'extension rpc failed');
        throw fail(cause, response.error.message);
      }
      return response.result;
    },
  };
};

/**
 * Срок импорта или экспорта у движка: больше обработчика (30 с), с запасом на
 * передачу файла.
 */
export const TRANSFER_CLIENT_DEADLINE_MS = 34_000;

export interface RemoteExtensionTransfersOptions {
  channel: HostChannel;
  logger: ExtensionLogger;
  deadlineMs?: number;
}

const transferCause = (cause: ExtFailureCause): ExtensionTransferErrorCause => {
  switch (cause) {
    case 'unknown-importer':
    case 'unknown-exporter':
    case 'invalid-result':
    case 'replaced':
    case 'handler-failed':
      return cause;
    case 'handler-timeout':
      return 'timeout';
    default:
      return 'handler-failed';
  }
};

export const createRemoteExtensionTransfers = (
  options: RemoteExtensionTransfersOptions,
): ExtensionTransfers => {
  const { channel, logger } = options;
  const deadlineMs = options.deadlineMs ?? TRANSFER_CLIENT_DEADLINE_MS;

  /** Общий путь: вызов хоста, свод причин, проверка результата теми же правилами, что в рантайме. */
  const run = async <T>(
    kind: 'import' | 'export',
    extensionId: string,
    id: string,
    call: () => Promise<ChannelOutcome>,
    check: (result: unknown) => T,
  ): Promise<T> => {
    const fail = (
      cause: ExtensionTransferErrorCause,
      message: string,
    ): ExtensionTransferError =>
      new ExtensionTransferError(cause, extensionId, id, kind, message);
    const outcome = await call();
    if (outcome.kind === 'timeout') {
      throw fail('timeout', `extension ${kind} timed out`);
    }
    if (outcome.kind !== 'response') {
      throw fail('host-down', 'extension host is down');
    }
    const { response } = outcome;
    if (!response.ok) {
      const cause = transferCause(response.error.cause);
      logger.debug(
        { extensionId, id, kind, cause },
        'extension transfer failed',
      );
      throw fail(cause, response.error.message);
    }
    try {
      return check(response.result);
    } catch (error) {
      if (!(error instanceof InvalidTransferResultError)) throw error;
      throw fail('invalid-result', error.message);
    }
  };

  // таймаут хост не перезапускает: выбор файла пользователем не должен убивать чужие вызовы
  return {
    runImporter: (extensionId, importerId, input) =>
      run(
        'import',
        extensionId,
        importerId,
        () =>
          channel.call(
            'runImporter',
            {
              extensionId,
              importerId,
              ...input,
            },
            deadlineMs,
            { restart: false },
          ),
        normalizeImportResult,
      ),
    runExporter: (extensionId, exporterId, input) =>
      run(
        'export',
        extensionId,
        exporterId,
        () =>
          channel.call(
            'runExporter',
            {
              extensionId,
              exporterId,
              input,
            },
            deadlineMs,
            { restart: false },
          ),
        normalizeExportResult,
      ),
  };
};
