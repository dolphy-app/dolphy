import type { EngineErrorDto } from '@spirula/engine-contract';

/** Ключи сообщений `repository.error.*`: лист каталога, без текста в коде. */
export type RepositoryErrorKey =
  | 'repository.error.fetch.not-found'
  | 'repository.error.fetch.auth-required'
  | 'repository.error.fetch.ref-not-found'
  | 'repository.error.fetch.timeout'
  | 'repository.error.fetch.network'
  | 'repository.error.fetch.too-large'
  | 'repository.error.fetch.cancelled'
  | 'repository.error.fetch.unknown'
  | 'repository.error.exists'
  | 'repository.error.invalid'
  | 'repository.error.notFound'
  | 'repository.error.rejected.symlink'
  | 'repository.error.rejected.path-escapes'
  | 'repository.error.rejected.git-segment'
  | 'repository.error.rejected.case-collision'
  | 'repository.error.rejected.special-file'
  | 'repository.error.rejected.too-many-files'
  | 'repository.error.rejected.too-large'
  | 'repository.error.rejected.file-too-large'
  | 'repository.error.rejected.no-courses'
  | 'repository.error.rejected.invalid-library'
  | 'repository.error.rejected.reload-rejected'
  | 'repository.error.rejected.path-conflict'
  | 'repository.error.rejected.unknown'
  | 'repository.error.unknown';

export interface RepositoryErrorView {
  key: RepositoryErrorKey;
  /** Поле формы, к которому относится ошибка (`INVALID_ARGUMENT`). */
  field?: 'url' | 'ref';
  /** Операцию прервал ученик: ошибкой в интерфейсе не показывается. */
  cancelled: boolean;
  /** Путь в репозитории, на котором сработало правило снимка. */
  path?: string;
  /** Тексты диагностик сканера и сообщение движка: не переводятся. */
  messages: string[];
}

const FETCH_REASONS = new Set([
  'not-found',
  'auth-required',
  'ref-not-found',
  'timeout',
  'network',
  'too-large',
  'cancelled',
]);
const REJECT_REASONS = new Set([
  'symlink',
  'path-escapes',
  'git-segment',
  'case-collision',
  'special-file',
  'too-many-files',
  'too-large',
  'file-too-large',
  'no-courses',
  'invalid-library',
  'reload-rejected',
  'path-conflict',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Ошибка вызова движка (`EngineCallError` и `lastError`) как `EngineErrorDto`. */
export const toEngineError = (caught: unknown): EngineErrorDto => {
  if (isRecord(caught) && typeof caught['code'] === 'string') {
    const details = caught['details'];
    return {
      code: caught['code'] as EngineErrorDto['code'],
      message: typeof caught['message'] === 'string' ? caught['message'] : '',
      retryable: caught['retryable'] === true,
      ...(isRecord(details) && { details }),
    };
  }
  return {
    code: 'INTERNAL',
    message: caught instanceof Error ? caught.message : String(caught),
    retryable: false,
  };
};

const diagnosticMessages = (details: Record<string, unknown>): string[] => {
  const list = details['diagnostics'];
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => (isRecord(item) ? item['message'] : undefined))
    .filter((message): message is string => typeof message === 'string');
};

/**
 * Код и `details` ошибки движка → ключ сообщения и данные для показа. Тексты
 * движка (диагностики, сообщение неизвестной ошибки) отдаются как есть.
 */
export const describeRepositoryError = (
  error: EngineErrorDto,
): RepositoryErrorView => {
  const details = error.details ?? {};
  const reason = details['reason'];
  const base = { cancelled: false, messages: [] as string[] };
  switch (error.code) {
    case 'INVALID_ARGUMENT': {
      const field = details['field'];
      return {
        ...base,
        key: 'repository.error.invalid',
        ...((field === 'url' || field === 'ref') && { field }),
        messages: [error.message],
      };
    }
    case 'REPOSITORY_EXISTS':
      return { ...base, key: 'repository.error.exists' };
    case 'NOT_FOUND':
      return { ...base, key: 'repository.error.notFound' };
    case 'GIT_FETCH_FAILED': {
      const known = typeof reason === 'string' && FETCH_REASONS.has(reason);
      return {
        ...base,
        cancelled: reason === 'cancelled',
        key: known
          ? (`repository.error.fetch.${reason}` as RepositoryErrorKey)
          : 'repository.error.fetch.unknown',
        ...(!known && { messages: [error.message] }),
      };
    }
    case 'REPOSITORY_REJECTED': {
      const known = typeof reason === 'string' && REJECT_REASONS.has(reason);
      const path = details['path'];
      const diagnostics = diagnosticMessages(details);
      const summary = details['summary'];
      return {
        ...base,
        key: known
          ? (`repository.error.rejected.${reason}` as RepositoryErrorKey)
          : 'repository.error.rejected.unknown',
        ...(typeof path === 'string' && { path }),
        messages:
          diagnostics.length > 0
            ? diagnostics
            : [typeof summary === 'string' ? summary : error.message],
      };
    }
    default:
      return {
        ...base,
        key: 'repository.error.unknown',
        messages: [error.message],
      };
  }
};
