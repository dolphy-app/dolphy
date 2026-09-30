import type { Page, PageRequest } from '@dolphy-app/engine-contract';
import { EngineError } from './errors.ts';

export const DEFAULT_PAGE_LIMIT = 100;
export const MAX_PAGE_LIMIT = 500;

const invalidArgument = (message: string, field: string): EngineError =>
  new EngineError('INVALID_ARGUMENT', { message, details: { field } });

export const encodeCursor = (offset: number): string =>
  btoa(String(offset))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

const decodeBase64Url = (cursor: string): string | null => {
  const base64 = cursor.replaceAll('-', '+').replaceAll('_', '/');
  try {
    return atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  } catch {
    return null;
  }
};

const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;

export const decodeCursor = (cursor: string): number => {
  if (!CURSOR_PATTERN.test(cursor)) {
    throw invalidArgument('Malformed cursor', 'cursor');
  }
  const text = decodeBase64Url(cursor);
  const offset = Number(text);
  const isCanonical =
    text !== null &&
    /^(0|[1-9]\d*)$/.test(text) &&
    Number.isSafeInteger(offset);
  if (!isCanonical || encodeCursor(offset) !== cursor) {
    throw invalidArgument('Malformed cursor', 'cursor');
  }
  return offset;
};

export const resolveLimit = (limit: number | undefined): number => {
  if (limit === undefined) return DEFAULT_PAGE_LIMIT;
  const isValid =
    Number.isInteger(limit) && limit >= 1 && limit <= MAX_PAGE_LIMIT;
  if (!isValid) {
    throw invalidArgument(
      `Page limit must be an integer in 1..${MAX_PAGE_LIMIT}`,
      'limit',
    );
  }
  return limit;
};

/**
 * Страница массива по смещению в курсоре. Порядок стабилен, пока стабилен
 * `items`; курсор за концом списка → пустая страница.
 */
export const paginate = <T>(
  items: readonly T[],
  req: PageRequest = {},
): Page<T> => {
  const limit = resolveLimit(req.limit);
  const offset = req.cursor === undefined ? 0 : decodeCursor(req.cursor);
  const end = offset + limit;
  const page = items.slice(offset, end);
  return end < items.length
    ? { items: page, nextCursor: encodeCursor(end) }
    : { items: page };
};
