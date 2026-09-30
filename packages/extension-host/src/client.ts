import type { MessageEndpoint } from '@lms/engine-contract';
import { ExerciseTypeError } from '@lms/engine/ports';
import type { ExerciseTypes, RawVerdict } from '@lms/engine/ports';
import type { ExtensionLogger } from '@lms/extension-api';
import type { createCatalog } from './catalog.ts';
import { gradeResultSchema } from './protocol.ts';
import type { ExtRequest, ExtResponse } from './protocol.ts';

export interface RemoteExerciseTypesOptions {
  catalog: ReturnType<typeof createCatalog>;
  logger: ExtensionLogger;
  /** Вызывается, когда вызов не уложился в дедлайн: синхронный цикл в расширении не прервать, хост надо перезапустить. */
  restart?: () => void;
  /** Дедлайн `grade` = `timeoutMs + graceMs`. */
  graceMs?: number;
  projectTimeoutMs?: number;
  /** Сколько ждать первый `attach`. */
  connectTimeoutMs?: number;
}

export type RemoteExerciseTypes = ExerciseTypes & {
  attach(endpoint: MessageEndpoint): void;
};

type Outcome =
  | { kind: 'response'; response: ExtResponse }
  | { kind: 'closed' }
  | { kind: 'timeout' }
  | { kind: 'no-host' };

interface Pending {
  settle(outcome: Outcome): void;
}

type RequestParams<M extends ExtRequest['method']> = Extract<
  ExtRequest,
  { method: M }
>['params'];

const isResponse = (value: unknown): value is ExtResponse =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { id?: unknown }).id === 'string' &&
  typeof (value as { ok?: unknown }).ok === 'boolean';

export const createRemoteExerciseTypes = (
  options: RemoteExerciseTypesOptions,
): RemoteExerciseTypes => {
  const { catalog, logger } = options;
  const graceMs = options.graceMs ?? 2000;
  const projectTimeoutMs = options.projectTimeoutMs ?? 5000;
  const connectTimeoutMs = options.connectTimeoutMs ?? 10_000;

  let nextId = 0;
  let endpoint: MessageEndpoint | null = null;
  let closed = false;
  const pending = new Map<string, Pending>();
  const connectWaiters = new Set<(endpoint: MessageEndpoint | null) => void>();

  const dropEndpoint = (dropped: MessageEndpoint): void => {
    if (endpoint !== dropped) return;
    endpoint = null;
    for (const entry of [...pending.values()]) entry.settle({ kind: 'closed' });
  };

  const awaitEndpoint = (): Promise<MessageEndpoint | null> => {
    if (endpoint !== null) return Promise.resolve(endpoint);
    if (closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      const slot: { timer?: ReturnType<typeof setTimeout> } = {};
      const done = (value: MessageEndpoint | null): void => {
        clearTimeout(slot.timer);
        connectWaiters.delete(done);
        resolve(value);
      };
      slot.timer = setTimeout(() => done(null), connectTimeoutMs);
      connectWaiters.add(done);
    });
  };

  const call = async (
    method: ExtRequest['method'],
    params: RequestParams<typeof method>,
    deadlineMs: number,
  ): Promise<Outcome> => {
    const target = await awaitEndpoint();
    if (target === null) return { kind: 'no-host' };
    const id = String(nextId++);
    return new Promise<Outcome>((resolve) => {
      const slot: { timer?: ReturnType<typeof setTimeout> } = {};
      const settle = (outcome: Outcome): void => {
        clearTimeout(slot.timer);
        pending.delete(id);
        resolve(outcome);
      };
      slot.timer = setTimeout(() => {
        settle({ kind: 'timeout' });
        options.restart?.();
      }, deadlineMs);
      pending.set(id, { settle });
      target.post({ id, method, params } as ExtRequest);
    });
  };

  const failure = (
    type: string,
    outcome: Exclude<Outcome, { kind: 'response' }>,
  ): ExerciseTypeError =>
    outcome.kind === 'timeout'
      ? new ExerciseTypeError('timeout', type, 'extension call timed out')
      : new ExerciseTypeError('host-down', type, 'extension host is down');

  const request = async (
    method: 'project' | 'referenceAnswer',
    params: RequestParams<'project'>,
  ): Promise<unknown> => {
    const outcome = await call(method, params, projectTimeoutMs);
    if (outcome.kind !== 'response') throw failure(params.type, outcome);
    const { response } = outcome;
    if (!response.ok) {
      throw new ExerciseTypeError(
        response.error.cause,
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

  const closeEndpoint = (): void => {
    const current = endpoint;
    if (current === null) return;
    current.close();
    dropEndpoint(current);
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
      const outcome = await call('grade', req, req.timeoutMs + graceMs);
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

    attach(next) {
      closeEndpoint();
      endpoint = next;
      next.onMessage((message) => {
        if (endpoint !== next) return;
        if (!isResponse(message)) {
          logger.warn({}, 'invalid extension host response ignored');
          return;
        }
        pending
          .get(message.id)
          ?.settle({ kind: 'response', response: message });
      });
      next.onClose(() => dropEndpoint(next));
      for (const waiter of [...connectWaiters]) waiter(next);
    },

    async close() {
      closed = true;
      closeEndpoint();
      for (const waiter of [...connectWaiters]) waiter(null);
    },
  };
};
