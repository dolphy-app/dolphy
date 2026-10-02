import type {
  EngineErrorCode,
  EngineErrorDto,
} from '@dolphy-app/engine-contract';
import type { Logger } from '../ports/index.ts';

interface ErrorSpec {
  message: string;
  retryable: boolean;
}

/** Коды и `retryable` по умолчанию — engine-ts-api.md §8. */
export const ERRORS: Record<EngineErrorCode, ErrorSpec> = {
  INVALID_ARGUMENT: { message: 'Invalid argument', retryable: false },
  NOT_FOUND: { message: 'Not found', retryable: false },
  ENGINE_CLOSED: { message: 'Engine is closed', retryable: true },
  INCOMPATIBLE_CONTRACT: {
    message: 'Incompatible contract version',
    retryable: false,
  },
  LIBRARY_NOT_LOADED: { message: 'Library is not loaded', retryable: false },
  LIBRARY_INVALID: { message: 'Library is invalid', retryable: false },
  ASSET_OUTSIDE_LIBRARY: {
    message: 'Asset path is outside the library',
    retryable: false,
  },
  ASSET_TOO_LARGE: { message: 'Asset is too large', retryable: false },
  ATTEMPT_NOT_FOUND: { message: 'Attempt not found', retryable: false },
  ATTEMPT_CLOSED: { message: 'Attempt is already closed', retryable: false },
  // retryable зависит от details.cause: 'unknown-type' → false, иначе true
  EXERCISE_TYPE_UNAVAILABLE: {
    message: 'Exercise type is unavailable',
    retryable: true,
  },
  PLACEMENT_SESSION_NOT_FOUND: {
    message: 'Placement session not found',
    retryable: false,
  },
  PLACEMENT_SESSION_ACTIVE: {
    message: 'Placement session is already active',
    retryable: false,
  },
  PLACEMENT_BUDGET_EXHAUSTED: {
    message: 'Placement budget exhausted',
    retryable: false,
  },
  SYNC_DEVICE_ID_CLASH: {
    message: 'Sync folder contains segments of this device id',
    retryable: false,
  },
  SYNC_CONFLICT_NOT_FOUND: {
    message: 'Sync conflict not found',
    retryable: false,
  },
  SYNC_FOLDER_NOT_CONFIGURED: {
    message: 'Sync folder is not configured',
    retryable: false,
  },
  STORE_BUSY: { message: 'Store is busy', retryable: true },
  STORE_READONLY: { message: 'Store is read-only', retryable: false },
  STORE_CORRUPT: { message: 'Store is corrupt', retryable: false },
  REPOSITORY_EXISTS: {
    message: 'Repository is already added',
    retryable: false,
  },
  REPOSITORY_REJECTED: {
    message: 'Repository snapshot was rejected',
    retryable: false,
  },
  // retryable зависит от details.reason: network, timeout, cancelled → true
  GIT_FETCH_FAILED: { message: 'Git fetch failed', retryable: false },
  CATALOG_UNAVAILABLE: {
    message: 'Extension catalog is unavailable',
    retryable: true,
  },
  // retryable зависит от details.reason: network → true
  EXTENSION_INSTALL_FAILED: {
    message: 'Extension installation failed',
    retryable: false,
  },
  EXTENSION_STORAGE_QUOTA: {
    message: 'Extension storage quota exceeded',
    retryable: false,
  },
  INTERNAL: { message: 'Internal engine error', retryable: true },
};

export interface EngineErrorOptions {
  message?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
  cause?: unknown;
}

const defaultRetryable = (
  code: EngineErrorCode,
  details: Record<string, unknown> | undefined,
): boolean => {
  if (code === 'EXERCISE_TYPE_UNAVAILABLE') {
    return details?.cause !== 'unknown-type';
  }
  if (code === 'EXTENSION_INSTALL_FAILED') {
    return details?.reason === 'network';
  }
  if (code === 'GIT_FETCH_FAILED') {
    const reason = details?.reason;
    return (
      reason === 'network' || reason === 'timeout' || reason === 'cancelled'
    );
  }
  return ERRORS[code].retryable;
};

/** Операционная ошибка движка; наружу уходят только код и `details`. */
export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(code: EngineErrorCode, options: EngineErrorOptions = {}) {
    super(options.message ?? ERRORS[code].message, { cause: options.cause });
    this.name = 'EngineError';
    this.code = code;
    this.retryable =
      options.retryable ?? defaultRetryable(code, options.details);
    if (options.details) this.details = options.details;
  }

  toDto(): EngineErrorDto {
    const { code, message, retryable, details } = this;
    return details
      ? { code, message, retryable, details }
      : { code, message, retryable };
  }
}

export interface ErrorMapperDeps {
  logger: Logger;
  markDirty(): void;
}

export type ErrorMapper = (error: unknown, path: string) => EngineError;

/** Программная ошибка → `INTERNAL` + лог + `dirty` (перестройка проекций). */
export const createErrorMapper =
  ({ logger, markDirty }: ErrorMapperDeps): ErrorMapper =>
  (error, path) => {
    if (error instanceof EngineError) return error;
    logger.error({ error, path }, 'programming error');
    markDirty();
    return new EngineError('INTERNAL', { cause: error, details: { path } });
  };
