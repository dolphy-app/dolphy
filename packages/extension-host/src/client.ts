import {
  ExerciseTypeError,
  ExtensionCommandError,
  GradePolicyError,
} from '@dolphy-app/engine/ports';
import type {
  ExerciseTypeErrorCause,
  ExerciseTypes,
  ExtensionCommandErrorCause,
  ExtensionCommands,
  ExtensionPolicy,
  GradePolicies,
  GradePolicyErrorCause,
  RawVerdict,
} from '@dolphy-app/engine/ports';
import type { ExtensionLogger } from '@dolphy-app/extension-api';
import type { createCatalog } from './catalog.ts';
import type { ChannelOutcome, ChannelParams, HostChannel } from './channel.ts';
import type { DiscoverySource } from './holder.ts';
import {
  commandOutcomeSchema,
  gradeResultSchema,
  gradeValueSchema,
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
    case 'handler-timeout':
    case 'replaced':
      return 'handler-failed';
    default:
      return cause;
  }
};

export interface RemoteExerciseTypesOptions {
  channel: HostChannel;
  catalog: ReturnType<typeof createCatalog>;
  /** Режим исполнения (`isolated`) вычисляется на каждый вызов. */
  policy: ExtensionPolicy;
  logger: ExtensionLogger;
  /** Дедлайн `grade` = `timeoutMs + graceMs`. */
  graceMs?: number;
  projectTimeoutMs?: number;
}

export interface RemoteGradePoliciesOptions {
  channel: HostChannel;
  catalog: ReturnType<typeof createCatalog>;
  policy: ExtensionPolicy;
  logger: ExtensionLogger;
  deadlineMs?: number;
}

export const createRemoteExerciseTypes = (
  options: RemoteExerciseTypesOptions,
): ExerciseTypes => {
  const { catalog, channel, policy } = options;
  const isolatedOwner = (type: string): boolean => {
    const owner = catalog.ownerOf(type);
    return owner === undefined ? true : policy.isIsolated(owner.id);
  };
  const graceMs = options.graceMs ?? 2000;
  const projectTimeoutMs = options.projectTimeoutMs ?? 5000;

  const failure = (
    type: string,
    outcome: Exclude<ChannelOutcome, { kind: 'response' }>,
  ): ExerciseTypeError =>
    outcome.kind === 'timeout'
      ? new ExerciseTypeError('timeout', type, 'extension call timed out')
      : new ExerciseTypeError('host-down', type, 'extension host is down');

  const request = async (
    method: 'project' | 'referenceAnswer',
    params: Omit<ChannelParams<'project'>, 'isolated'>,
  ): Promise<unknown> => {
    const outcome = await channel.call(
      method,
      { ...params, isolated: isolatedOwner(params.type) },
      projectTimeoutMs,
    );
    if (outcome.kind !== 'response') throw failure(params.type, outcome);
    const { response } = outcome;
    if (!response.ok) {
      const { cause } = response.error;
      throw new ExerciseTypeError(
        exerciseCause(cause),
        params.type,
        response.error.message,
      );
    }
    return response.result;
  };

  const toVerdict = (
    response: ExtResponse,
    durationMs: number,
    authorMode: boolean,
  ): RawVerdict => {
    if (!response.ok) {
      return {
        outcome: 'error',
        reason: 'internal',
        durationMs,
        ...(authorMode && { feedback: response.error.message.slice(0, 4000) }),
      };
    }
    const parsed = gradeResultSchema.safeParse(response.result);
    if (!parsed.success) {
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
      const outcome = await channel.call(
        'grade',
        { ...req, isolated: isolatedOwner(req.type) },
        req.timeoutMs + graceMs,
      );
      const durationMs = Math.round(performance.now() - started);
      switch (outcome.kind) {
        case 'response':
          return toVerdict(outcome.response, durationMs, req.authorMode);
        case 'timeout':
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
  const { catalog, channel, logger, policy } = options;
  const deadlineMs = options.deadlineMs ?? POLICY_DEADLINE_MS;
  const isolatedPolicy = (id: string): boolean => {
    const owner = catalog.ownerOfPolicy(id);
    return owner === undefined ? true : policy.isIsolated(owner.id);
  };
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
          isolated: isolatedPolicy(id),
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
 * Срок вызова команды у движка: больше раннера ограниченного процесса (12 с) и
 * обработчика (10 с), включает ленивую активацию и запуск процесса.
 */
export const COMMAND_CLIENT_DEADLINE_MS = 14_000;

export interface RemoteExtensionCommandsOptions {
  channel: HostChannel;
  /** Набор расширений движка: панель, на которую указывает `openPanel`, обязана в нём быть. */
  discovery: DiscoverySource;
  /** Режим исполнения (`isolated`) вычисляется на каждый вызов. */
  policy: ExtensionPolicy;
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
  const { channel, discovery, policy, logger } = options;
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
          isolated: policy.isIsolated(extensionId),
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
      const declared = discovery
        .get()
        .extensions.find(({ id }) => id === extensionId)
        ?.panels.some(({ id }) => id === data.panelId);
      if (declared !== true) {
        throw fail(
          'invalid-result',
          `extension command opened an undeclared panel '${data.panelId}'`,
        );
      }
      return data.props === undefined
        ? { kind: 'openPanel', panelId: data.panelId }
        : { kind: 'openPanel', panelId: data.panelId, props: data.props };
    },
  };
};
