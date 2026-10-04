import type { HostFailure, HostMethod, HostRequest } from './protocol.ts';

/** Параметры запроса хоста к движку. */
export type HostParams<M extends HostMethod> = Extract<
  HostRequest,
  { method: M }
>['params'];

/**
 * Запросы хоста расширений к движку (данные расширения). Ответ — результат
 * сервиса движка; отказ — `EngineRequestError`.
 */
export interface EngineLink {
  request<M extends HostMethod>(
    method: M,
    params: HostParams<M>,
  ): Promise<unknown>;
}

/** Срок ответа движка на запрос хоста; по истечении запрос отклоняется, перезапуск хоста не взводится. */
export const ENGINE_REQUEST_MS = 5000;

/** Отказ движка (или канала) на запрос хоста. */
export class EngineRequestError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;
  constructor(failure: HostFailure) {
    super(failure.message);
    this.name = 'EngineRequestError';
    this.code = failure.code;
    this.details = failure.details;
  }
}

const MAX_MESSAGE = 500;

/** Отказ сервиса движка в виде, пригодном для канала: код и `details` ошибки движка, любая другая — `INTERNAL`. */
export const hostFailureOf = (error: unknown): HostFailure => {
  if (!(error instanceof Error)) {
    return { code: 'INTERNAL', message: String(error).slice(0, MAX_MESSAGE) };
  }
  const { code, details } = error as Error & {
    code?: unknown;
    details?: unknown;
  };
  const hasDetails =
    typeof details === 'object' && details !== null && !Array.isArray(details);
  return {
    code: typeof code === 'string' ? code : 'INTERNAL',
    message: error.message.slice(0, MAX_MESSAGE),
    ...(hasDetails && { details: details as Record<string, unknown> }),
  };
};
