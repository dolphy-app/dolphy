import type { Page } from '@spirula/engine-contract';
import { describe, expect, it } from 'vitest';
import { EngineError } from '../../src/app/index.ts';
import { paginate } from '../../src/app/pagination.ts';

const range = (count: number): number[] =>
  Array.from({ length: count }, (_, index) => index);

const collect = <T>(items: readonly T[], limit: number): T[][] => {
  const pages: T[][] = [];
  let cursor: string | undefined;
  do {
    const page: Page<T> = paginate(
      items,
      cursor ? { limit, cursor } : { limit },
    );
    pages.push(page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return pages;
};

const invalidArgument = (run: () => unknown): void => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(EngineError);
    expect((error as EngineError).code).toBe('INVALID_ARGUMENT');
    return;
  }
  expect.unreachable('INVALID_ARGUMENT expected');
};

describe('paginate', () => {
  it('returns everything without nextCursor when it fits the default limit', () => {
    expect(paginate(range(100))).toEqual({ items: range(100) });
    expect(paginate([])).toEqual({ items: [] });
  });

  it('defaults to 100 items per page and caps at 500', () => {
    const items = range(650);
    const first = paginate(items);
    expect(first.items).toHaveLength(100);
    expect(first.nextCursor).toBeTypeOf('string');
    expect(paginate(items, { limit: 500 }).items).toHaveLength(500);
  });

  it('walks pages in stable order without gaps or duplicates', () => {
    const items = range(23);
    const pages = collect(items, 5);
    expect(pages.map((page) => page.length)).toEqual([5, 5, 5, 5, 3]);
    expect(pages.flat()).toEqual(items);
  });

  it('does not emit an empty trailing page when the size is a multiple of limit', () => {
    expect(collect(range(10), 5)).toEqual([
      [0, 1, 2, 3, 4],
      [5, 6, 7, 8, 9],
    ]);
  });

  it('cursor is opaque base64url', () => {
    const { nextCursor } = paginate(range(10), { limit: 3 });
    expect(nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(nextCursor).not.toBe('3');
  });

  it('a cursor past the end yields an empty page', () => {
    const { nextCursor } = paginate(range(10), { limit: 8 });
    const shorter = paginate(range(3), { cursor: nextCursor! });
    expect(shorter).toEqual({ items: [] });
  });

  it.each([0, -1, 1.5, 501, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects limit %s',
    (limit) => {
      invalidArgument(() => paginate(range(3), { limit }));
    },
  );

  it.each(['', '!!', '3', 'abc', 'LTE', 'MDE', 'LTE=', 'a b'])(
    'rejects malformed cursor %j',
    (cursor) => {
      invalidArgument(() => paginate(range(3), { cursor }));
    },
  );
});
