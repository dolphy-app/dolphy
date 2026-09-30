import { describe, expect, it } from 'vitest';
import type {
  RepositoryRecord,
  RepositoryStore,
} from '../../src/ports/index.ts';

const record = (id: string, patch: Partial<RepositoryRecord> = {}) => ({
  id,
  url: `https://example.com/${id}.git`,
  ref: null,
  commit: 'a'.repeat(40),
  fetchedAt: 1_700_000_000_000,
  courseIds: ['c1'],
  ...patch,
});

/** Общий набор проверок адаптеров `RepositoryStore` (память, SQLite). */
export const describeRepositoryStoreContract = (
  name: string,
  make: () => Promise<RepositoryStore>,
) =>
  describe(`RepositoryStore (${name})`, () => {
    it('пустое хранилище: пустой список', async () => {
      expect(await (await make()).list()).toEqual([]);
    });

    it('put вставляет запись со всеми полями', async () => {
      const store = await make();
      const full = record('r', {
        ref: 'refs/heads/main',
        courseIds: ['a', 'b'],
        lastError: {
          code: 'GIT_FETCH_FAILED',
          message: 'boom',
          retryable: true,
          details: { reason: 'timeout' },
        },
      });
      await store.put(full);
      expect(await store.list()).toEqual([full]);
    });

    it('put с тем же id заменяет запись, lastError исчезает', async () => {
      const store = await make();
      await store.put(
        record('r', {
          lastError: {
            code: 'GIT_FETCH_FAILED',
            message: 'x',
            retryable: true,
          },
        }),
      );
      const next = record('r', { commit: 'b'.repeat(40), courseIds: [] });
      await store.put(next);
      const [only, ...rest] = await store.list();
      expect(rest).toEqual([]);
      expect(only).toEqual(next);
      expect(only).not.toHaveProperty('lastError');
    });

    it('list отсортирован по id (BMP: кодовые единицы = кодовые точки)', async () => {
      const store = await make();
      for (const id of ['я', 'b', 'é', 'B', 'a']) await store.put(record(id));
      expect((await store.list()).map((r) => r.id)).toEqual([
        'B',
        'a',
        'b',
        'é',
        'я',
      ]);
    });

    it('delete: true один раз, затем false; чужие записи целы', async () => {
      const store = await make();
      await store.put(record('a'));
      await store.put(record('b'));
      expect(await store.delete('a')).toBe(true);
      expect(await store.delete('a')).toBe(false);
      expect(await store.delete('nope')).toBe(false);
      expect((await store.list()).map((r) => r.id)).toEqual(['b']);
    });

    it('копии изолированы: вход и выход можно мутировать', async () => {
      const store = await make();
      const input = record('r');
      await store.put(input);
      input.courseIds.push('mutated');
      const listed = await store.list();
      (listed[0]!.courseIds as string[]).push('mutated-out');
      (listed[0] as { url: string }).url = 'mutated';
      expect(await store.list()).toEqual([record('r')]);
    });

    it('не-ASCII url и ref переживают round-trip', async () => {
      const store = await make();
      const value = record('я/😀', {
        url: 'https://пример.рф/курс/😀.git',
        ref: 'refs/heads/ветка',
      });
      await store.put(value);
      expect(await store.list()).toEqual([value]);
    });
  });
